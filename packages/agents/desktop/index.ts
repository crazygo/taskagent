/**
 * Start Agent - Unified interface for dispatching to atomic and composite agents
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
import type { tool as createSdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { addLog } from '@taskagent/shared/logger';
import type { AgentRegistry } from '../registry/AgentRegistry.js';

const START_AGENT_ID = 'start';
const START_DESCRIPTION = 'Start - Unified interface for dispatching tasks to atomic and composite agents';

export async function createAgent(options?: { 
  eventBus?: EventBus;
  tabExecutor?: any;
  messageStore?: any;
  agentRegistry?: AgentRegistry;
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

    addLog(`[Start] Loaded agent definitions: ${Object.keys(agentDefinitions || {})}`);
    addLog(`[Start] System prompt length: ${systemPrompt?.length || 0}`);
    addLog(`[Start] Allowed tools: ${allowedTools}`);

    const getPrompt = (userInput: string) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const childAgentIds = ['blueprint', 'devhub', 'feature-writer', 'coder', 'review'] as const;
    const childAgents = new Map<string, RunnableAgent>();

    if (options?.agentRegistry) {
        for (const id of childAgentIds) {
            const agent = await options.agentRegistry.createAgent(id);
            if (agent) {
                childAgents.set(id, agent);
            } else {
                addLog(`[Start] Warning: ${id} agent unavailable; corresponding workflow tools disabled.`);
            }
        }
    }

    const buildChildToolMap = (ctx: { sourceTabId: string; workspacePath?: string; rawContext?: AgentStartContext }) => {
        if (childAgents.size === 0) {
            return undefined;
        }

        const tools: Record<string, ReturnType<typeof createSdkTool>> = {};
        const parentAgentId = ctx.rawContext?.parentAgentId ?? START_AGENT_ID;

        for (const [id, agent] of childAgents.entries()) {
            if (!agent.asMcpTool) continue;
            const childTool = agent.asMcpTool({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId,
            });
            if (childTool) {
                tools[id] = childTool;
            }
        }

        addLog(`[Start] Built child tool map: ${JSON.stringify(tools, null, 2)}`);
        return Object.keys(tools).length ? tools : undefined;
    };

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpTools: (ctx) =>
            buildChildToolMap({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                rawContext: ctx.rawContext,
            }),
    });

    return {
        id: START_AGENT_ID,
        description: START_DESCRIPTION,
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
                    addLog(`[Start] Child agent active: ${childAgentId}`);
                }
                activeChildAgents.add(childAgentId);
                cleanupDeferred = true;
            };

            const markChildInactive = (childAgentId?: string) => {
                if (!childAgentId) return;
                if (activeChildAgents.delete(childAgentId)) {
                    addLog(`[Start] Child agent inactive: ${childAgentId}`);
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
                addLog('[Start] Removing event listeners');
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
                    
                    // Only mirror direct child agents (those calling Start as parent)
                    if (parentAgentId !== 'start') return;

                    // Start does not surface Blueprint's or DevHub's self-dialogue; 
                    // users can view those tabs directly. Skip mirroring assistant chunks.
                    // Milestone updates still emit via agentEventHandler for important progress.
                    if (childAgentId === 'blueprint' || childAgentId === 'devhub') return;
                    markChildActive(childAgentId);
                    if (!chunk) return;

                    // Direct write to MessageStore
                    addLog(`[Start][agentTextHandler] mirroring child agent ${childAgentId} output, len=${chunk.length}`);
                    options?.messageStore?.appendMessage('Start', {
                        id: options.messageStore.getNextMessageId(),
                        role: 'assistant',
                        content: `[${childAgentId}] ${chunk}`,
                        isPending: false,
                        variant: 'worker',
                        timestamp: event.timestamp || Date.now(),
                    });
                } catch (e) {
                    addLog(`[Start] mirror handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            const agentEventHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const payload = event?.payload;
                    
                    // Only handle events from direct child agents
                    if (parentAgentId !== 'start') return;
                    if (payload && typeof payload === 'object' && (payload.kind === 'task:progress' || payload.kind === 'task:result')) {
                        // Progress/result events are handled by AgentBridge to keep Start view consistent
                        return;
                    }
                    markChildActive(childAgentId);
                    
                    // Mirror progress messages
                    if (payload?.message) {
                        addLog(`[Start][agentEventHandler] mirroring event from ${childAgentId}: ${payload.message}`);
                        options?.messageStore?.appendMessage('Start', {
                            id: options.messageStore.getNextMessageId(),
                            role: 'assistant',
                            content: `[${childAgentId}] ${payload.message}`,
                            isPending: false,
                            variant: 'worker',
                            timestamp: event.timestamp || Date.now(),
                        });
                    }
                } catch (e) {
                    addLog(`[Start] agent:event handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            const agentCompletedHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    
                    if (parentAgentId !== 'start') return;
                    addLog(`[Start] Child agent completed: ${childAgentId}`);
                    markChildInactive(childAgentId);
                } catch (e) {
                    addLog(`[Start] agent:completed handler error: ${e instanceof Error ? e.message : String(e)}`);
                }
            };

            // Register event listeners
            if (options?.eventBus && options?.messageStore) {
                addLog('[Start] Registering event listeners for this execution');
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
                        addLog('[Start] Deferring listener cleanup until child agents finish');
                    }
                });
            }
            
            return handle;
        },
    };
}
