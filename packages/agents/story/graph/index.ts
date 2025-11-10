import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { addLog } from '@taskagent/shared/logger';
import { loadAgentPipelineConfig } from '../../runtime/agentLoader.js';
import { buildPromptAgentStart } from '../../runtime/runPromptAgentStart.js';
import type {
    AgentStartContext,
    AgentStartSinks,
    ExecutionHandle,
    RunnableAgent,
} from '../../runtime/types.js';

const STORY_GRAPH_AGENT_ID = 'story-graph';
const STORY_GRAPH_DESCRIPTION = 'Features Editor Graph workflow (update → diff → YAML review)';
const MAX_ITERATIONS = 3;

type PromptStarter = (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;

export interface StoryGraphTaskInput {
    targetFile: string;
    instructions: string;
    contextNotes?: string;
}

export interface StoryChangeSummary {
    type: 'added' | 'modified' | 'removed' | 'unknown';
    summary: string;
    path?: string;
}

export interface StoryWorkResult {
    targetFile: string;
    iterations: number;
    diff?: string;
    changes: StoryChangeSummary[];
    yamlValidation: { ok: true } | { ok: false; error: string };
    notes: string[];
    workerOutput: string;
}

interface StoryWorkerPayload {
    targetFile?: string;
    changes?: StoryChangeSummary[];
    diffSummary?: string;
    notes?: string[];
}

export async function createGraphAgent(): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));
    const { systemPrompt, agents } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'worker.agent.md',
    });

    const workerStart = buildPromptAgentStart({
        getPrompt: (input: string) => input,
        getSystemPrompt: () => systemPrompt,
        getAgentDefinitions: () => agents,
        getModel: () => undefined,
    });

    return new StoryGraphAgent(workerStart);
}

class StoryGraphAgent implements RunnableAgent {
    readonly id = STORY_GRAPH_AGENT_ID;
    readonly description = STORY_GRAPH_DESCRIPTION;

    constructor(private readonly workerStart: PromptStarter) {}

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        const controller = new AbortController();
        const completion = this.run(userInput, context, sinks, controller.signal)
            .then(() => true)
            .catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                sinks.onFailed?.(message);
                return false;
            });

        return {
            cancel: () => controller.abort(),
            sessionId: context.session?.id ?? `${STORY_GRAPH_AGENT_ID}-${Date.now()}`,
            completion,
        };
    }

    private async run(
        userInput: string,
        context: AgentStartContext,
        sinks: AgentStartSinks,
        signal: AbortSignal
    ): Promise<void> {
        const workspacePath = context.workspacePath;
        if (!workspacePath) {
            throw new Error('Features Editor Graph requires workspacePath in context.');
        }
        const task = parseTaskInput(userInput);
        this.emitEvent(sinks, 'ack', `FeaturesGraph 接收任务，目标文件 ${task.targetFile}`);

        let iteration = 0;
        let feedback: string | undefined;
        let workerOutput = '';

        while (iteration < MAX_ITERATIONS && !signal.aborted) {
            iteration++;
            this.emitEvent(sinks, 'progress', `[FeaturesGraph] Iteration ${iteration} - update`);

            const prompt = this.buildWorkerPrompt(task, iteration, feedback);
            workerOutput = await this.invokeWorker(prompt, context, sinks, signal);

            this.emitEvent(sinks, 'progress', `[FeaturesGraph] Iteration ${iteration} - diff`);

            const validation = await validateIfNeeded(workspacePath, task.targetFile);
            if (!validation.ok) {
                const errorMessage = validation.error;
                this.emitEvent(
                    sinks,
                    'progress',
                    `[FeaturesGraph] Iteration ${iteration} - review failed: ${errorMessage}`
                );
                feedback = buildValidationFeedback(errorMessage, iteration);
                continue;
            }

            this.emitEvent(sinks, 'progress', `[FeaturesGraph] Iteration ${iteration} - review passed`);

            const diff = await collectDiff(workspacePath, task.targetFile);
            const workerPayload = parseWorkerOutput(workerOutput);
            const notes = workerPayload?.notes ? [...workerPayload.notes] : [];
            if (!workerPayload) {
                notes.push('worker_output 缺少 <work_result> JSON，已退回到 git diff 摘要。');
            }
            if (!diff) {
                notes.push('git diff 为空，可能是新文件或已提交状态，请人工确认。');
            }
            const workResult: StoryWorkResult = {
                targetFile: task.targetFile,
                iterations: iteration,
                diff,
                workerOutput,
                yamlValidation: { ok: true },
                changes: buildChangeSummaries(workerPayload, diff, task.targetFile),
                notes,
            };

            this.emitResult(sinks, workResult);
            sinks.onCompleted?.('[FeaturesGraph] workflow completed');
            return;
        }

        throw new Error('Features Editor Graph workflow exceeded maximum retries or was aborted.');
    }

    private buildWorkerPrompt(
        task: StoryGraphTaskInput,
        iteration: number,
        feedback?: string
    ): string {
        const lines = [
            `# Story Graph Task`,
            `Iteration: ${iteration}`,
            `Target File: ${task.targetFile}`,
            `Instructions:\n${task.instructions.trim()}`,
        ];
        if (task.contextNotes) {
            lines.push(`Context Notes:\n${task.contextNotes.trim()}`);
        }
        if (feedback) {
            lines.push(`Validator Feedback:\n${feedback.trim()}`);
        }
        lines.push(
            '请严格执行 Update → Diff 步骤，并以 `<work_result>{...}</work_result>` JSON 格式输出事实数据。'
        );
        return lines.join('\n\n');
    }

    private async invokeWorker(
        prompt: string,
        context: AgentStartContext,
        sinks: AgentStartSinks,
        signal: AbortSignal
    ): Promise<string> {
        if (signal.aborted) {
            throw new Error('Features Editor Graph worker invocation aborted.');
        }

        let buffer = '';
        let workerFailedMessage: string | null = null;
        const childSinks: AgentStartSinks = {
            onText: chunk => {
                buffer += chunk;
            },
            onEvent: event => sinks.onEvent?.(event),
            onReasoning: chunk => sinks.onReasoning?.(chunk),
            onCompleted: () => {},
            onFailed: error => {
                workerFailedMessage = error;
            },
            canUseTool: sinks.canUseTool,
        };

        const handle = this.workerStart(prompt, { ...context, forkSession: true }, childSinks);
        signal.addEventListener('abort', () => handle.cancel(), { once: true });
        const success = await handle.completion;
        if (!success || workerFailedMessage) {
            throw new Error(workerFailedMessage || 'Features Editor Graph iteration failed.');
        }
        return buffer.trim();
    }

    private emitEvent(sinks: AgentStartSinks, message: string, payload?: unknown) {
        sinks.onEvent?.({
            message,
            payload,
            level: 'info',
            ts: Date.now(),
        } as any);
    }

    private emitResult(sinks: AgentStartSinks, result: StoryWorkResult) {
        this.emitEvent(sinks, 'features-editor:result', result);
        sinks.onEvent?.({
            type: 'features:result',
            payload: result,
            level: 'info',
            ts: Date.now(),
        } as any);
    }
}

function parseTaskInput(raw: string): StoryGraphTaskInput {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Features Editor Graph 输入必须是 JSON 对象。');
        }
        if (!parsed.targetFile || typeof parsed.targetFile !== 'string') {
            throw new Error('Features Editor Graph 输入缺少 targetFile 字段。');
        }
        if (!parsed.instructions || typeof parsed.instructions !== 'string') {
            throw new Error('Features Editor Graph 输入缺少 instructions 字段。');
        }
        return {
            targetFile: parsed.targetFile,
            instructions: parsed.instructions,
            contextNotes: typeof parsed.contextNotes === 'string' ? parsed.contextNotes : undefined,
        };
    } catch (error) {
        throw new Error(
            `Features Editor Graph 需要 JSON 输入，例如 {"targetFile":"docs/story.yaml","instructions":"..."}。解析失败: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

async function validateIfNeeded(
    workspacePath: string,
    targetFile: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const isYaml = /\.ya?ml$/i.test(targetFile);
    if (!isYaml) {
        return { ok: true };
    }

    try {
        const absPath = path.resolve(workspacePath, targetFile);
        const content = await fs.readFile(absPath, 'utf-8');
        yaml.load(content);
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

const execFileAsync = promisify(execFile);

async function collectDiff(workspacePath: string, targetFile: string): Promise<string> {
    try {
        const relPath = path.relative(workspacePath, path.resolve(workspacePath, targetFile));
        const { stdout } = await execFileAsync('git', ['--no-pager', 'diff', '--', relPath], {
            cwd: workspacePath,
        });
        return stdout.trim();
    } catch (error) {
        addLog(`[StoryGraph] git diff failed: ${error instanceof Error ? error.message : String(error)}`);
        return '';
    }
}

function buildChangeSummaries(
    workerPayload: StoryWorkerPayload | null,
    diff: string,
    targetFile: string
): StoryChangeSummary[] {
    if (workerPayload?.changes && workerPayload.changes.length > 0) {
        return workerPayload.changes;
    }

    if (diff) {
        const summaryLines = diff
            .split('\n')
            .filter(line => line.startsWith('+') || line.startsWith('-'))
            .slice(0, 10)
            .join('\n');

        return [
            {
                type: 'modified',
                summary: `来自 git diff 的片段：\n${summaryLines}`,
                path: targetFile,
            },
        ];
    }

    return [
        {
            type: 'unknown',
            summary: `目标文件 ${targetFile} 没有可用的 diff 或 worker 变更摘要。`,
        },
    ];
}

function buildValidationFeedback(error: string, iteration: number): string {
    return `第 ${iteration} 轮写入的 Story 文档存在 YAML 语法错误：${error}。\n请修复语法后重新写入。`;
}

function parseWorkerOutput(output: string): StoryWorkerPayload | null {
    const match = output.match(/<work_result>([\s\S]+?)<\/work_result>/i);
    if (!match) {
        return null;
    }

    try {
        const jsonText = match[1]!.trim();
        const payload = JSON.parse(jsonText);
        if (payload && typeof payload === 'object') {
            return payload;
        }
        return null;
    } catch (error) {
        addLog(
            `[StoryGraph] Failed to parse worker output: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    }
}
