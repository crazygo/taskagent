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
import { createDevHubMcpServer } from './tools.js';
import { addLog } from '@taskagent/shared/logger';

const DEV_HUB_AGENT_ID = 'devhub';
const DEV_HUB_DESCRIPTION = '开发枢纽，理解用户需求并协调开发与审查流程';

export async function createAgent(options?: { 
  eventBus?: EventBus;
  tabExecutor?: any;
  messageStore?: any;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    // Save current context for event handlers
    let currentContext: AgentStartContext | null = null;

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

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpServers: (ctx) => {
            if (!options?.tabExecutor) {
                return undefined;
            }
            const server = createDevHubMcpServer({
                tabExecutor: options.tabExecutor,
                workspacePath: ctx.workspacePath,
            });
            return {
                'devhub-tools': server,
            };
        },
    });

    return {
        id: DEV_HUB_AGENT_ID,
        description: DEV_HUB_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
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
