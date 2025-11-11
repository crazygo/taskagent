/**
 * Desktop Agent - Unified interface for dispatching to atomic and composite agents
 * 
 * Capabilities:
 * - Dialog with user
 * - Dispatch to: blueprint, writer, coder, reviewer
 * - Mirror progress from child agents
 * - Support parallel task execution
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { createDesktopMcpServer } from './tools.js';
import { addLog } from '@taskagent/shared/logger';

const DESKTOP_AGENT_ID = 'desktop';
const DESKTOP_DESCRIPTION = 'Desktop - Unified interface for dispatching tasks to atomic and composite agents';

export async function createAgent(options?: { 
  eventBus?: EventBus;
  tabExecutor?: any;
  messageStore?: any;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    // Load agent pipeline configuration
    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    addLog(`[Desktop] Loaded agent definitions: ${Object.keys(agentDefinitions || {})}`);
    addLog(`[Desktop] System prompt length: ${systemPrompt?.length || 0}`);
    addLog(`[Desktop] Allowed tools: ${allowedTools}`);

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
            const server = createDesktopMcpServer({
                tabExecutor: options.tabExecutor,
                workspacePath: ctx.workspacePath,
            });
            return {
                'desktop-tools': server,
            };
        },
    });

    return {
        id: DESKTOP_AGENT_ID,
        description: DESKTOP_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
            const activeChildAgents = new Set<string>();
            let handleCompleted = false;
            let cleanupDeferred = false;

            const markChildActive = (childAgentId?: string) => {
                if (!childAgentId) return;
                if (!activeChildAgents.has(childAgentId)) {
                    addLog(`[Desktop] Child agent active: ${childAgentId}`);
                }
                activeChildAgents.add(childAgentId);
                cleanupDeferred = true;
            };

            const markChildInactive = (childAgentId?: string) => {
                if (!childAgentId) return;
                if (activeChildAgents.delete(childAgentId)) {
                    addLog(`[Desktop] Child agent inactive: ${childAgentId}`);
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
                addLog('[Desktop] Removing event listeners');
                options.eventBus.off('agent:text', agentTextHandler);
                options.eventBus.off('agent:event', agentEventHandler);
                options.eventBus.off('agent:completed', agentCompletedHandler);
                listenersRegistered = false;
                cleanupDeferred = false;
                activeChildAgents.clear();
            };

            // Event handlers
            const agentTextHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const chunk = typeof event.payload === 'string' ? event.payload : '';
                    
                    // Only mirror direct child agents (those calling Desktop as parent)
                    if (parentAgentId !== 'desktop') return;

                    // Desktop does not surface Blueprint's self-dialogue; users can view
                    // Blueprint tab directly, so skip mirroring those assistant chunks.
                    // Blueprint's milestone updates still emit via agentEventHandler, so
                    // important progress is preserved.
                    if (childAgentId === 'blueprint') return;
                    markChildActive(childAgentId);
                    if (!chunk) return;

                    // Direct write to MessageStore
                    addLog(`[Desktop][agentTextHandler] mirroring child agent ${childAgentId} output, len=${chunk.length}`);
                    options?.messageStore?.appendMessage('Desktop', {
                        id: options.messageStore.getNextMessageId(),
                        role: 'assistant',
                        content: `[${childAgentId}] ${chunk}`,
                        isPending: false,
                        variant: 'worker',
                        timestamp: event.timestamp || Date.now(),
                    });
                } catch (e) {
                    addLog(`[Desktop] mirror handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            const agentEventHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const payload = event?.payload;
                    
                    // Only handle events from direct child agents
                    if (parentAgentId !== 'desktop') return;
                    markChildActive(childAgentId);
                    
                    // Mirror progress messages
                    if (payload?.message) {
                        addLog(`[Desktop][agentEventHandler] mirroring event from ${childAgentId}: ${payload.message}`);
                        options?.messageStore?.appendMessage('Desktop', {
                            id: options.messageStore.getNextMessageId(),
                            role: 'assistant',
                            content: `[${childAgentId}] ${payload.message}`,
                            isPending: false,
                            variant: 'worker',
                            timestamp: event.timestamp || Date.now(),
                        });
                    }
                } catch (e) {
                    addLog(`[Desktop] agent:event handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            const agentCompletedHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    
                    if (parentAgentId !== 'desktop') return;
                    addLog(`[Desktop] Child agent completed: ${childAgentId}`);
                    markChildInactive(childAgentId);
                } catch (e) {
                    addLog(`[Desktop] agent:completed handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            // Register event listeners
            if (options?.eventBus && options?.messageStore) {
                addLog('[Desktop] Registering event listeners for this execution');
                options.eventBus.on('agent:text', agentTextHandler);
                options.eventBus.on('agent:event', agentEventHandler);
                options.eventBus.on('agent:completed', agentCompletedHandler);
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
                        addLog('[Desktop] Deferring listener cleanup until child agents finish');
                    }
                });
            }
            
            return handle;
        },
    };
}
