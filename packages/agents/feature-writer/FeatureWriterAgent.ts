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
        
        // Extract task_id from structured prompt (first line: "Task ID: xxx")
        const taskIdMatch = task.match(/^Task ID:\s*([a-z0-9\-]+)/im);
        const task_id = taskIdMatch?.[1]?.trim() || '';
        
        addLog(`[FeatureWriter] Received task_id: ${task_id}`);
        
        if (!task_id || task_id.trim().length === 0) {
            const message = '❌ 缺少 task_id。Prompt 必须以 "Task ID: xxx" 开头';
            addLog(`[FeatureWriter] ${message}`);
            return {
                content: [{ type: 'text', text: message }],
            };
        }

        if (!context.tabExecutor) {
            const message = 'TabExecutor 未初始化，无法启动 Feature Writer';
            addLog(`[FeatureWriter] ${message}`);
            return {
                content: [{ type: 'text', text: message }],
            };
        }

        try {
            addLog(`[FeatureWriter] Starting task_id: ${task_id}, task: ${task.substring(0, 100)}...`);
            
            // Start the agent with the task description
            // The agent will use its tools (Read, Write, Edit, Glob) to complete the task
            // This is delegated to the PromptAgent's start() method via tabExecutor
            
            const result = await context.tabExecutor.executeAgent(
                'feature-writer',
                task,
                context
            );
            
            addLog(`[FeatureWriter] Completed task_id: ${task_id}`);
            return {
                content: [{ 
                    type: 'text', 
                    text: `✅ Feature Writer completed task_id: ${task_id}\n${result || '文件已更新'}` 
                }],
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`[FeatureWriter] Error for task_id ${task_id}: ${message}`);
            return {
                content: [{ type: 'text', text: `❌ Error (task_id: ${task_id}): ${message}` }],
            };
        }
    }
}
