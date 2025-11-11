/**
 * DevHub Agent - 开发枢纽
 * 
 * 职责：
 * - 理解用户自然语言
 * - 路由任务到 Looper
 * - 订阅 Looper 消息，转述给用户
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { createWorkflowToolset } from '../runtime/workflowTools.js';
import { getDevHubToolDefinitions, getDevHubOperatorToolDefinitions, type DevLoopBridge } from './workflows.js';
import { addLog } from '@taskagent/shared/logger';
import type { tool as createSdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { TaskManager } from '@taskagent/shared/task-manager';
import { createAgent as createLooperAgent } from './looper/index.js';
import type { LooperCommand } from './looper/command.js';
import type { WorkflowRuntimeContext } from '../runtime/workflowTools.js';

const DEV_HUB_AGENT_ID = 'devhub';
const DEV_HUB_DESCRIPTION = '开发枢纽，理解用户需求并协调开发与审查流程';

export async function createAgent(options?: { 
  eventBus?: EventBus;
  tabExecutor?: any;
  messageStore?: any;
  taskManager?: TaskManager;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    // Save current context for event handlers
    let currentContext: AgentStartContext | null = null;

    let looperAgent: RunnableAgent | null = null;
    try {
        looperAgent = await createLooperAgent({ taskManager: options?.taskManager });
        addLog('[DevHub] Looper agent initialized for internal workflows');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[DevHub] Failed to initialize Looper agent: ${message}`);
    }

    // Load agent pipeline configuration (coordinator + sub-agents)
    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    addLog(`[DevHub] Loaded agent definitions: ${Object.keys(agentDefinitions || {})}`);
    addLog(`[DevHub] System prompt length: ${systemPrompt?.length || 0}`);
    addLog(`[DevHub] Allowed tools: ${allowedTools}`);

    const getPrompt = (userInput: string) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const looperBridge = createLooperBridge({
        looperAgent,
        eventBus: options?.eventBus,
    });

    const publicToolset = createWorkflowToolset({
        agentId: DEV_HUB_AGENT_ID,
        sharedDependencies: {
            tabExecutor: options?.tabExecutor,
            defaultParentAgentId: DEV_HUB_AGENT_ID,
        },
        tool: getDevHubToolDefinitions(looperBridge),
    });

    const operatorToolset = createWorkflowToolset({
        agentId: `${DEV_HUB_AGENT_ID}-ops`,
        sharedDependencies: {
            tabExecutor: options?.tabExecutor,
            defaultParentAgentId: DEV_HUB_AGENT_ID,
        },
        tool: getDevHubOperatorToolDefinitions(looperBridge),
    });

    const resolvePublicTool = (ctx: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string }) =>
        publicToolset.asMcpTool({
            sourceTabId: ctx.sourceTabId,
            workspacePath: ctx.workspacePath,
            parentAgentId: ctx.parentAgentId ?? DEV_HUB_AGENT_ID,
        });

    const resolveOperatorTool = (ctx: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string }) =>
        operatorToolset.asMcpTool({
            sourceTabId: ctx.sourceTabId,
            workspacePath: ctx.workspacePath,
            parentAgentId: ctx.parentAgentId ?? DEV_HUB_AGENT_ID,
        });

    const buildDevHubToolMap = (ctx: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string }) => {
        const tools: Record<string, ReturnType<typeof createSdkTool>> = {};

        const publicTool = resolvePublicTool(ctx);
        if (publicTool) {
            tools[DEV_HUB_AGENT_ID] = publicTool;
        }

        if ((ctx.sourceTabId ?? '').toLowerCase() === 'devhub') {
            const operatorTool = resolveOperatorTool(ctx);
            if (operatorTool) {
                tools['devhub_command_tool'] = operatorTool;
            }
        }

        return Object.keys(tools).length ? tools : undefined;
    };

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpTools: (ctx) =>
            buildDevHubToolMap({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.rawContext?.parentAgentId ?? DEV_HUB_AGENT_ID,
            }),
    });

    return {
        id: DEV_HUB_AGENT_ID,
        description: DEV_HUB_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        asMcpTool: (ctx) =>
            resolvePublicTool({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.parentAgentId ?? DEV_HUB_AGENT_ID,
            }),
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
            // Save context for event handlers
            currentContext = context;
            
            const activeChildAgents = new Set<string>();
            let handleCompleted = false;
            let cleanupDeferred = false;

            const markChildActive = (childAgentId?: string) => {
                if (!childAgentId) return;
                if (!activeChildAgents.has(childAgentId)) {
                    addLog(`[DevHub] Child agent active: ${childAgentId}`);
                }
                activeChildAgents.add(childAgentId);
                cleanupDeferred = true;
            };

            const markChildInactive = (childAgentId?: string) => {
                if (!childAgentId) return;
                if (activeChildAgents.delete(childAgentId)) {
                    addLog(`[DevHub] Child agent inactive: ${childAgentId}`);
                    if (handleCompleted && activeChildAgents.size === 0) {
                        cleanupListeners();
                    }
                }
            };

            let listenersRegistered = false;
            const cleanupListeners = () => {
                if (!listenersRegistered || !options?.eventBus) {
                    return;
                }
                addLog('[DevHub] Removing event listeners');
                options.eventBus.off('agent:text', agentTextHandler);
                options.eventBus.off('agent:event', agentEventHandler);
                listenersRegistered = false;
                cleanupDeferred = false;
                activeChildAgents.clear();
            };

            // Define event handlers that will be registered and cleaned up
            const agentTextHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const chunk = typeof event.payload === 'string' ? event.payload : '';
                    
                    addLog(`[DevHub] agent:text seen: agent=${childAgentId} parentAgent=${parentAgentId} chunk.length=${chunk.length}`);
                    
                    // Only mirror direct child agents (those calling DevHub as parent)
                    if (parentAgentId !== 'devhub') return;
                    markChildActive(childAgentId);
                    if (!chunk) return;
                    
                    // Direct write to MessageStore, bypassing conversation queue
                    addLog(`[DevHub] mirroring child agent ${childAgentId} output, len=${chunk.length}`);
                    options?.messageStore?.appendMessage('DevHub', {
                        id: options.messageStore.getNextMessageId(),
                        role: 'assistant',
                        content: `[${childAgentId}] ${chunk}`,
                        isPending: false,
                        timestamp: event.timestamp || Date.now(),
                    });
                } catch (e) {
                    addLog(`[DevHub] mirror handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            const agentEventHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const payload = event?.payload;
                    
                    addLog(`[DevHub] agent:event seen: agent=${childAgentId} parentAgent=${parentAgentId} message=${payload?.message}`);
                    
                    // Only handle events from direct child agents
                    if (parentAgentId !== 'devhub') return;
                    markChildActive(childAgentId);
                    
                    // Handle looper events
                    if (payload?.message?.startsWith('looper:')) {
                        // looper:result - trigger AI to process result
                        if (payload.message === 'looper:result' && payload.payload) {
                            addLog(`[DevHub] Received looper:result: ${JSON.stringify(payload.payload).substring(0, 100)}`);
                            
                            // 1. 显示 info
                            options?.messageStore?.appendMessage('DevHub', {
                                id: options.messageStore.getNextMessageId(),
                                role: 'system',
                                content: 'Looper 任务完成，正在分析结果...',
                                timestamp: event.timestamp || Date.now(),
                            });
                            
                            // 4. 触发 AI 执行
                            setTimeout(async () => {
                                try {
                                    await options?.tabExecutor?.execute('DevHub', 'devhub', 
                                        `Looper 任务完成，结果：\n\n${payload.payload}\n\n请向用户转述这个结果。`,
                                        { 
                                            sourceTabId: 'DevHub',
                                            workspacePath: currentContext?.workspacePath,
                                        }
                                    );
                                } catch (err) {
                                    addLog(`[DevHub] Failed to trigger AI: ${err instanceof Error ? err.message : String(err)}`);
                                }
                            }, 100);
                            markChildInactive(childAgentId);
                            return;
                        }
                        
                        // looper:progress - mirror to DevHub tab
                        if (payload.message === 'looper:progress' && payload.payload) {
                            addLog(`[DevHub] mirroring looper:progress, len=${String(payload.payload).length}`);
                            options?.messageStore?.appendMessage('DevHub', {
                                id: options.messageStore.getNextMessageId(),
                                role: 'assistant',
                                content: `[${childAgentId}] ${payload.payload}`,
                                isPending: false,
                                timestamp: event.timestamp || Date.now(),
                            });
                            return;
                        }
                    }
                } catch (e) {
                    addLog(`[DevHub] agent:event handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            // Register event listeners only for this execution
            if (options?.eventBus && options?.messageStore) {
                    addLog('[DevHub] Registering event listeners for this execution');
                    options.eventBus.on('agent:text', agentTextHandler);
                    options.eventBus.on('agent:event', agentEventHandler);
                    listenersRegistered = true;
                }
            
            // Inject tabExecutor into context for tools
            const enhancedContext = {
                ...context,
                tabExecutor: options?.tabExecutor,
            };
            
            // Start the agent
            const handle = start(userInput, enhancedContext as any, sinks);
            
            // Cleanup event listeners when execution completes
            if (options?.eventBus && options?.messageStore) {
                handle.completion.finally(() => {
                    handleCompleted = true;
                    if (!cleanupDeferred || activeChildAgents.size === 0) {
                        cleanupListeners();
                    } else {
                        addLog('[DevHub] Deferring listener cleanup until child agents finish');
                    }
                });
            }
            
            return handle;
        },
    };
}

function createLooperBridge(params: {
    looperAgent: RunnableAgent | null;
    eventBus?: EventBus;
}): DevLoopBridge {
    const { looperAgent, eventBus } = params;

    const runCommand = async (command: LooperCommand, context: WorkflowRuntimeContext) => {
        if (!looperAgent) {
            return {
                message: 'Looper 未初始化，无法执行命令。',
                isError: true,
            };
        }

        const payload = JSON.stringify(command);
        let responseText = '';
        let failedMessage: string | undefined;

        const sinks: AgentStartSinks = {
            onText: () => {},
            onReasoning: () => {},
            onEvent: (event) => {
                try {
                    eventBus?.emit({
                        type: 'agent:event',
                        agentId: 'looper',
                        parentAgentId: DEV_HUB_AGENT_ID,
                        tabId: context.sourceTabId ?? 'DevHub',
                        timestamp: Date.now(),
                        payload: event,
                        version: '1.0',
                    });
                } catch (error) {
                    addLog(`[DevHub] Failed to emit looper event: ${error instanceof Error ? error.message : String(error)}`);
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
            const handle = looperAgent.start(
                payload,
                {
                    sourceTabId: context.sourceTabId ?? 'DevHub',
                    workspacePath: context.workspacePath,
                    parentAgentId: context.parentAgentId ?? DEV_HUB_AGENT_ID,
                } as AgentStartContext,
                sinks
            );
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
            message: responseText || `[Looper] 已处理命令: ${command.type}`,
        };
    };

    return {
        startLoop: (task, context) => runCommand({ type: 'start', task }, context),
        sendCommand: (command, context) => runCommand(command, context),
    };
}
