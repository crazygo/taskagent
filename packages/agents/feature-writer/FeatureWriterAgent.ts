import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { addLog } from '@taskagent/shared/logger';

const FEATURE_WRITER_AGENT_ID = 'feature-writer';
const FEATURE_WRITER_DESCRIPTION = 'Feature Writer - Write structured feature YAML files';

interface FeatureWriterAgentDeps {
    tabExecutor?: any;
    systemPrompt?: any;
    agentDefinitions?: Record<string, AgentDefinition>;
    allowedTools?: string[];
    eventBus?: EventBus;
    agentRegistry?: AgentRegistry;
}

export class FeatureWriterAgent extends PromptAgent implements RunnableAgent {
    readonly id = FEATURE_WRITER_AGENT_ID;
    readonly description = FEATURE_WRITER_DESCRIPTION;
    
    protected readonly inputSchema = {
        task: z.string().min(1).describe('写作任务描述，包含目标文件和内容要求'),
    };

    constructor(private deps: FeatureWriterAgentDeps) {
        super();
    }

    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            tabExecutor: this.deps.tabExecutor,
            eventBus: this.deps.eventBus,
            agentRegistry: this.deps.agentRegistry,
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
            parentAgentId: context.parentAgentId ?? FEATURE_WRITER_AGENT_ID,
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
            const message = 'TabExecutor 未初始化，无法启动 Feature Writer';
            addLog(`[FeatureWriter] ${message}`);
            return {
                content: [{ type: 'text', text: message }],
            };
        }

        try {
            addLog(`[FeatureWriter] Starting task: ${task.substring(0, 100)}...`);
            return {
                content: [{ type: 'text', text: `Feature Writer received: ${task}` }],
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`[FeatureWriter] Error: ${message}`);
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
            };
        }
    }
}
