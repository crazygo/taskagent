import path from 'path';
import { fileURLToPath } from 'url';
import type {
    AgentStartContext,
    AgentStartSinks,
    ExecutionHandle,
    RunnableAgent,
} from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { parseAgentMdFile } from '../runtime/agentLoader.js';
import { createGraphAgent, type StoryGraphTaskInput, type StoryWorkResult } from './graph/index.js';

const FEATURES_EDITOR_AGENT_ID = 'features-editor';
const FEATURES_EDITOR_DESCRIPTION = 'Features Editor - planner → graph → summarizer 自动写作工作流';

type PromptStarter = (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;

type PlannerOutput = StoryGraphTaskInput;

type SummarizerInput = {
    user_input: string;
    task: StoryGraphTaskInput;
    work_result: StoryWorkResult;
};

export async function createFeaturesEditorAgent(): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const plannerConfig = await parseAgentMdFile(path.join(agentDir, 'planner.agent.md'));
    if (!plannerConfig) {
        throw new Error('Failed to load story planner agent definition.');
    }

    const summarizerConfig = await parseAgentMdFile(path.join(agentDir, 'summarizer.agent.md'));
    if (!summarizerConfig) {
        throw new Error('Failed to load story summarizer agent definition.');
    }

    const plannerStart = buildPromptAgentStart({
        getPrompt: (input: string) => input.trim(),
        getSystemPrompt: () => plannerConfig.prompt,
        getModel: () => plannerConfig.model,
    });

    const summarizerStart = buildPromptAgentStart({
        getPrompt: (input: string) => input.trim(),
        getSystemPrompt: () => summarizerConfig.prompt,
        getModel: () => summarizerConfig.model,
    });

    const graphAgent = await createGraphAgent();

    return new FeaturesEditorAgent(plannerStart, summarizerStart, graphAgent);
}

class FeaturesEditorAgent implements RunnableAgent {
    readonly id = FEATURES_EDITOR_AGENT_ID;
    readonly description = FEATURES_EDITOR_DESCRIPTION;

    constructor(
        private readonly plannerStart: PromptStarter,
        private readonly summarizerStart: PromptStarter,
        private readonly graphAgent: RunnableAgent
    ) {}

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        const controller = new AbortController();
        const completion = this.run(userInput, context, sinks, controller.signal)
            .then(summary => {
                if (summary) {
                    sinks.onText?.(summary);
                    sinks.onCompleted?.(summary);
                } else {
                    sinks.onCompleted?.('');
                }
                return true;
            })
            .catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                sinks.onFailed?.(message);
                return false;
            });

        return {
            cancel: () => controller.abort(),
            sessionId: context.session?.id ?? `${FEATURES_EDITOR_AGENT_ID}-${Date.now()}`,
            completion,
        };
    }

    private async run(
        userInput: string,
        context: AgentStartContext,
        sinks: AgentStartSinks,
        signal: AbortSignal
    ): Promise<string> {
        if (!context.workspacePath) {
            throw new Error('Features Editor requires workspacePath.');
        }

        this.emitProgress(sinks, '[FeaturesEditor] 分析需求…');
        const planText = await this.invokePrompt(this.plannerStart, userInput, context, sinks, signal, {
            forwardEvents: false,
            label: 'planner',
        });
        const task = parsePlannerOutput(planText);
        this.emitProgress(sinks, `[FeaturesEditor] 目标文件: ${task.targetFile}`);

        this.emitProgress(sinks, '[FeaturesEditor] 启动写作流程 (update → diff → review)…');
        const workResult = await this.runGraphWorkflow(task, context, sinks, signal);
        this.emitProgress(sinks, '[FeaturesEditor] 写作完成，整理总结…');

        const summaryInput: SummarizerInput = {
            user_input: userInput,
            task,
            work_result: workResult,
        };
        const summaryPayload = JSON.stringify(summaryInput, null, 2);
        const summary = await this.invokePrompt(this.summarizerStart, summaryPayload, context, sinks, signal, {
            forwardEvents: false,
            label: 'summarizer',
        });

        sinks.onEvent?.({
            type: 'features:result',
            level: 'info',
            payload: workResult,
            ts: Date.now(),
        } as any);

        return summary.trim();
    }

    private async invokePrompt(
        starter: PromptStarter,
        promptInput: string,
        context: AgentStartContext,
        parentSinks: AgentStartSinks,
        signal: AbortSignal,
        options?: { forwardEvents?: boolean; label?: string }
    ): Promise<string> {
        if (signal.aborted) {
            throw new Error('Features Editor prompt invocation aborted.');
        }

        let buffer = '';
        let failedMessage: string | null = null;
        const childSinks: AgentStartSinks = {
            onText: chunk => {
                buffer += chunk;
                if (options?.forwardEvents) {
                    parentSinks.onText?.(chunk);
                }
            },
            onEvent: event => {
                if (options?.forwardEvents) {
                    parentSinks.onEvent?.(event);
                }
            },
            onReasoning: chunk => {
                if (options?.forwardEvents) {
                    parentSinks.onReasoning?.(chunk);
                }
            },
            onCompleted: () => {},
            onFailed: error => {
                failedMessage = error;
            },
            canUseTool: parentSinks.canUseTool,
        };

        const handle = starter(promptInput, { ...context, forkSession: true }, childSinks);
        signal.addEventListener('abort', () => handle.cancel(), { once: true });
        const success = await handle.completion;
        if (!success || failedMessage) {
            const label = options?.label ? `[FeaturesEditor ${options.label}] ` : '';
            throw new Error(label + (failedMessage || 'Prompt execution failed'));
        }
        return buffer.trim();
    }

    private async runGraphWorkflow(
        task: StoryGraphTaskInput,
        context: AgentStartContext,
        parentSinks: AgentStartSinks,
        signal: AbortSignal
    ): Promise<StoryWorkResult> {
        if (signal.aborted) {
            throw new Error('Features Editor graph run aborted.');
        }

        const graphInput = JSON.stringify(task);
        let result: StoryWorkResult | null = null;
        let failedMessage: string | null = null;

        const graphSinks: AgentStartSinks = {
            onText: chunk => parentSinks.onText?.(chunk),
            onReasoning: chunk => parentSinks.onReasoning?.(chunk),
            onEvent: event => {
                parentSinks.onEvent?.(event);
                const payloadEvent = event as any;
                if (payloadEvent?.type === 'features:result' && payloadEvent.payload) {
                    result = payloadEvent.payload as StoryWorkResult;
                }
            },
            onCompleted: () => {},
            onFailed: error => {
                failedMessage = error;
            },
            canUseTool: parentSinks.canUseTool,
        };

        const handle = this.graphAgent.start(
            graphInput,
            { ...context, forkSession: true, parentAgentId: FEATURES_EDITOR_AGENT_ID },
            graphSinks
        );
        signal.addEventListener('abort', () => handle.cancel(), { once: true });
        const success = await handle.completion;

        if (!success || failedMessage) {
            throw new Error(failedMessage || 'Features Editor graph workflow failed.');
        }
        if (!result) {
            throw new Error('Features Editor graph workflow completed without emitting result.');
        }

        return result;
    }

    private emitProgress(sinks: AgentStartSinks, message: string) {
        sinks.onEvent?.({
            type: 'features:progress',
            level: 'info',
            message,
            ts: Date.now(),
        } as any);
    }
}

function parsePlannerOutput(raw: string): PlannerOutput {
    const cleaned = extractJsonBlock(raw);
    try {
        const parsed = JSON.parse(cleaned);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Planner output is not a JSON object.');
        }
        if (!parsed.targetFile || typeof parsed.targetFile !== 'string') {
            throw new Error('Planner output is missing "targetFile".');
        }
        if (!parsed.instructions || typeof parsed.instructions !== 'string') {
            throw new Error('Planner output is missing "instructions".');
        }
        return {
            targetFile: parsed.targetFile.trim(),
            instructions: parsed.instructions.trim(),
            contextNotes:
                typeof parsed.contextNotes === 'string' && parsed.contextNotes.trim().length > 0
                    ? parsed.contextNotes.trim()
                    : undefined,
        };
    } catch (error) {
        throw new Error(
            `无法解析规划结果，请确保输出 JSON 格式。错误: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function extractJsonBlock(text: string): string {
    const trimmed = text.trim();
    const fencedMatch = trimmed.match(/```json([\s\S]+?)```/i);
    if (fencedMatch) {
        return fencedMatch[1]!.trim();
    }
    return trimmed;
}
