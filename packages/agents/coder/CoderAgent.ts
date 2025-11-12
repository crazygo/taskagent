import { z } from 'zod';
import { addLog } from '@taskagent/shared/logger';
import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const CODER_AGENT_ID = 'coder';

interface CoderAgentDeps {
    tabExecutor: any;
    systemPrompt: any;
    agentDefinitions?: Record<string, AgentDefinition>;
    allowedTools?: string[];
}

export class CoderAgent extends PromptAgent implements RunnableAgent {
    readonly id = CODER_AGENT_ID;
    readonly description = 'Backend development executor for implementing features with self-testing';
    
    protected readonly inputSchema = {
        task: z.string().min(1).describe('编码任务描述'),
    };

    constructor(private deps: CoderAgentDeps) {
        super();
    }

    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            tabExecutor: this.deps.tabExecutor,
        };
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        return userInput.trim();
    }

    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
        return this.deps.agentDefinitions;
    }

    getTools(): string[] {
        return this.deps.allowedTools ?? [];
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.setRuntimeContext({
            sourceTabId: context.sourceTabId,
            workspacePath: context.workspacePath,
            parentAgentId: context.parentAgentId ?? CODER_AGENT_ID,
        });
        
        const startFn = buildPromptAgentStart({
            getPrompt: (userInput: string) => this.getPrompt(userInput, context),
            getSystemPrompt: () => this.deps.systemPrompt,
            getAgentDefinitions: () => this.getAgentDefinitions(),
            getMcpTools: () => {
                const tool = this.asMcpTool();
                return tool ? { [this.id]: tool } : undefined;
            },
        });
        
        return startFn(userInput, context, sinks);
    }

    protected async execute(args: { task: string }, context: AgentToolContext): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
        const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');

        if (!context.tabExecutor) {
            const message = 'TabExecutor 未初始化，无法启动 Coder';
            addLog(`[Coder] ${message}`);
            return {
                content: [{ type: 'text', text: message }],
            };
        }

        try {
            addLog(`[Coder] Starting task: ${task.substring(0, 100)}...`);

            const result = await context.tabExecutor.execute(
                'Coder',
                'coder',
                task,
                {
                    sourceTabId: context.sourceTabId ?? 'Start',
                    workspacePath: context.workspacePath,
                    parentAgentId: context.parentAgentId ?? CODER_AGENT_ID,
                },
                { async: false }
            );

            return {
                content: [{ type: 'text', text: `✅ Coder 完成\n\n${result}` }],
            };
        } catch (error) {
            const message = `启动 Coder 失败: ${error instanceof Error ? error.message : String(error)}`;
            addLog(`[Coder] ${message}`);
            return {
                content: [{ type: 'text', text: message }],
            };
        }
    }
}
