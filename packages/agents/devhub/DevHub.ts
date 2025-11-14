/**
 * DevHub - Development Hub Coordinator
 * 
 * A PromptAgent that coordinates development tasks by:
 * - Understanding user requirements in natural language
 * - Routing tasks to CodingLoop for iterative development
 * - Monitoring progress and relaying updates to users
 */

import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { EventBus } from '@core/event-bus';
import type { TaskManager } from '@shared/task-manager';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import { CodingLoop } from './coding-loop/index.js';
import type { LooperCommand } from './coding-loop/command.js';
import { addLog } from '@shared/logger';

const DEV_HUB_AGENT_ID = 'devhub';
const DEV_HUB_DESCRIPTION = 'DevHub Agent - 理解开发需求，协调 Coder 与 Reviewer 循环开发直到代码通过审查';

interface DevHubOptions {
    eventBus?: EventBus;
    tabExecutor?: any;
    messageStore?: any;
    taskManager?: TaskManager;
    agentRegistry?: AgentRegistry;
}

export class DevHub extends PromptAgent implements RunnableAgent {
    readonly id = DEV_HUB_AGENT_ID;
    readonly description = DEV_HUB_DESCRIPTION;

    protected readonly inputSchema = {
        request: z.string().describe('开发请求或命令'),
    };

    private codingLoop?: CodingLoop;
    private systemPrompt?: string;
    private agentDefinitions?: Record<string, AgentDefinition>;
    private allowedTools?: string[];

    constructor(private options: DevHubOptions) {
        super();
    }

    async initialize() {
        const agentDir = path.dirname(fileURLToPath(import.meta.url));

        // Load coordinator prompt and configuration
        const config = await loadAgentPipelineConfig(agentDir, {
            coordinatorFileName: 'coordinator.agent.md',
        });

        this.systemPrompt = config.systemPrompt;
        this.agentDefinitions = config.agents;
        this.allowedTools = config.allowedTools;

        addLog(`[DevHub] Loaded agent definitions: ${Object.keys(config.agents || {})}`);
        addLog(`[DevHub] System prompt length: ${this.systemPrompt?.length || 0}`);
        addLog(`[DevHub] Allowed tools: ${this.allowedTools}`);

        // Create CodingLoop
        try {
            this.codingLoop = new CodingLoop();
            await this.codingLoop.initialize();
            addLog('[DevHub] CodingLoop initialized');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`[DevHub] Failed to initialize CodingLoop: ${message}`);
        }
    }

    /**
     * Execute a command on CodingLoop and relay events to EventBus
     */
    private async executeCodingLoopCommand(
        command: LooperCommand,
        context: AgentStartContext
    ): Promise<{ message: string; isError?: boolean }> {
        if (!this.codingLoop) {
            throw new Error('CodingLoop not initialized');
        }

        const payload = JSON.stringify(command);
        let responseText = '';
        let failedMessage: string | undefined;

        const sinks: AgentStartSinks = {
            onText: () => {},
            onReasoning: () => {},
            onEvent: (event) => {
                try {
                    this.options.eventBus?.emit({
                        type: 'agent:event',
                        agentId: 'looper',
                        parentAgentId: DEV_HUB_AGENT_ID,
                        tabId: context.sourceTabId ?? 'DevHub',
                        timestamp: Date.now(),
                        payload: event,
                        version: '1.0',
                    });
                } catch (error) {
                    addLog(`[DevHub] Failed to emit event: ${error instanceof Error ? error.message : String(error)}`);
                }
            },
            onCompleted: (text) => {
                responseText = text;
            },
            onFailed: (error) => {
                failedMessage = error;
            },
            canUseTool: async (_toolName, input) => ({
                behavior: 'allow',
                updatedInput: input,
            }),
        };

        try {
            const handle = this.codingLoop.start(payload, context, sinks);
            await handle.completion;
        } catch (error) {
            failedMessage = error instanceof Error ? error.message : String(error);
        }

        if (failedMessage) {
            return {
                message: failedMessage,
                isError: true,
            };
        }

        return {
            message: responseText || `[CodingLoop] 已处理命令: ${command.type}`,
        };
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        return userInput.trim();
    }

    getSystemPrompt(): string {
        return this.systemPrompt || '';
    }

    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
        return this.agentDefinitions;
    }

    getTools(): string[] {
        return this.allowedTools ?? [];
    }

    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            eventBus: this.options.eventBus,
            tabExecutor: this.options.tabExecutor,
            agentRegistry: this.options.agentRegistry,
        };
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.setRuntimeContext({
            sourceTabId: context.sourceTabId,
            workspacePath: context.workspacePath,
            parentAgentId: context.parentAgentId,
        });

        const devHubStart = buildPromptAgentStart({
            getPrompt: (input) => this.getPrompt(input, {
                sourceTabId: context.sourceTabId,
                workspacePath: context.workspacePath,
            }),
            getSystemPrompt: () => this.getSystemPrompt(),
            getAgentDefinitions: () => this.getAgentDefinitions(),
            getMcpTools: (ctx) => this.buildMcpTools(ctx),
        });

        return devHubStart(userInput, context, sinks);
    }

    private buildMcpTools(ctx: any): Record<string, any> | undefined {
        const { tool } = require('@anthropic-ai/claude-agent-sdk');
        const tools: Record<string, any> = {};

        // Public tool: run_dev_loop
        tools['run_dev_loop'] = tool(
            'run_dev_loop',
            '启动开发循环，协调 Coder / Reviewer 迭代直至代码通过审查',
            { task: z.string().min(1).describe('开发任务描述') },
            async (args: { task: string }) => {
                const task = typeof args.task === 'string' ? args.task : String(args.task ?? '');
                
                try {
                    addLog(`[DevHub] Starting dev loop: ${task.substring(0, 100)}...`);
                    const result = await this.executeCodingLoopCommand(
                        { type: 'start', task },
                        {
                            sourceTabId: ctx.sourceTabId ?? 'DevHub',
                            workspacePath: ctx.workspacePath,
                            parentAgentId: DEV_HUB_AGENT_ID,
                        }
                    );
                    return result.message;
                } catch (error) {
                    const message = `启动失败: ${error instanceof Error ? error.message : String(error)}`;
                    addLog(`[DevHub] ${message}`);
                    throw new Error(message);
                }
            }
        );

        // Operator tool: devhub_command_tool (only for DevHub tab)
        if ((ctx.sourceTabId ?? '').toLowerCase() === 'devhub') {
            tools['devhub_command_tool'] = tool(
                'devhub_command_tool',
                '向 CodingLoop 发送命令',
                {
                    command: z.enum(['start', 'stop', 'status', 'add_pending']),
                    task: z.string().optional(),
                },
                async (args: { command: string; task?: string }) => {
                    const command = args.command;
                    const task = args.task;

                    const payload: LooperCommand = task
                        ? { type: command as any, task }
                        : { type: command as any };

                    try {
                        addLog(`[DevHub] Sending command: ${JSON.stringify(payload)}`);
                        const result = await this.executeCodingLoopCommand(
                            payload,
                            {
                                sourceTabId: ctx.sourceTabId ?? 'DevHub',
                                workspacePath: ctx.workspacePath,
                                parentAgentId: DEV_HUB_AGENT_ID,
                            }
                        );
                        return result.message || `命令已执行: ${command}`;
                    } catch (error) {
                        const message = `命令失败: ${error instanceof Error ? error.message : String(error)}`;
                        addLog(`[DevHub] ${message}`);
                        throw new Error(message);
                    }
                }
            );
        }

        return Object.keys(tools).length ? tools : undefined;
    }

    protected async execute(
        args: { request: string },
        context: AgentToolContext
    ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
        // DevHub is typically called directly via start(), not as a tool
        // But we implement execute() for completeness
        const request = args.request;
        addLog(`[DevHub] Execute called with request: ${request}`);

        return {
            content: [{ type: 'text', text: `DevHub received: ${request}` }],
        };
    }
}

export async function createAgent(options?: DevHubOptions): Promise<RunnableAgent> {
    const devhub = new DevHub(options || {});
    await devhub.initialize();
    return devhub;
}
