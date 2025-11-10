import path from 'path';
import { fileURLToPath } from 'url';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type {
    AgentContext,
    AgentStartContext,
    AgentStartSinks,
    ExecutionHandle,
    RunnableAgent,
} from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { createStoryMcpServer } from './tools.js';
import { addLog } from '@taskagent/shared/logger';

const STORY_AGENT_ID = 'story';
const STORY_DESCRIPTION = 'Story coordinator agent (dialog + workflow orchestration)';

export async function createAgent(options?: {
    eventBus?: EventBus;
    tabExecutor?: any;
    messageStore?: any;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    const getPrompt = (userInput: string) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const startPrompt = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpServers: (ctx) => {
            if (!options?.tabExecutor) {
                return undefined;
            }
            return {
                'story-tools': createStoryMcpServer({
                    tabExecutor: options.tabExecutor,
                    workspacePath: ctx.workspacePath,
                    tabId: ctx.sourceTabId,
                }),
            };
        },
    });

    return {
        id: STORY_AGENT_ID,
        description: STORY_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
            const messageStore = options?.messageStore;
            const activeChildAgents = new Set<string>();
            let listenersRegistered = false;
            let cleanupDeferred = false;
            let handleCompleted = false;
            const tabId = context.sourceTabId || 'Story';

            const registerChild = (agentId?: string) => {
                if (!agentId) return;
                if (!activeChildAgents.has(agentId)) {
                    addLog(`[Story] Child agent active: ${agentId}`);
                }
                activeChildAgents.add(agentId);
                cleanupDeferred = true;
            };

            const unregisterChild = (agentId?: string) => {
                if (!agentId) return;
                if (activeChildAgents.delete(agentId)) {
                    addLog(`[Story] Child agent inactive: ${agentId}`);
                    if (handleCompleted && activeChildAgents.size === 0) {
                        cleanup();
                    }
                }
            };

            const cleanup = () => {
                if (!listenersRegistered || !options?.eventBus) return;
                addLog('[Story] Removing event listeners');
                options.eventBus.off('agent:text', agentTextHandler);
                options.eventBus.off('agent:event', agentEventHandler);
                listenersRegistered = false;
                cleanupDeferred = false;
                activeChildAgents.clear();
            };

            const agentTextHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const chunk = typeof event.payload === 'string' ? event.payload : '';

                    if (parentAgentId !== 'story') return;
                    registerChild(childAgentId);
                    if (!chunk) return;

                    if (messageStore) {
                        const id = messageStore.getNextMessageId();
                        messageStore.appendMessage(tabId, {
                            id,
                            role: 'assistant',
                            content: `[${childAgentId}] ${chunk}`,
                            isPending: false,
                            timestamp: event.timestamp || Date.now(),
                        });
                    }
                } catch (error) {
                    addLog(`[Story] agent:text handler error: ${error instanceof Error ? error.message : String(error)}`);
                }
            };

            const agentEventHandler = (event: any) => {
                try {
                    const childAgentId = event?.agentId;
                    const parentAgentId = event?.parentAgentId;
                    const payload = event?.payload;

                    if (parentAgentId !== 'story') return;
                    registerChild(childAgentId);

                    if (payload) {
                        const text = typeof payload?.payload === 'string'
                            ? payload.payload
                            : payload?.message || payload?.type;
                        if (text && messageStore) {
                            const id = messageStore.getNextMessageId();
                            messageStore.appendMessage(tabId, {
                                id,
                                role: 'assistant',
                                content: `[${childAgentId}] ${text}`,
                                isPending: false,
                                timestamp: event.timestamp || Date.now(),
                            });
                        }
                    }

                    if (
                        payload?.type === 'features:result' ||
                        payload?.message === 'features-editor:result'
                    ) {
                        unregisterChild(childAgentId);
                    }
                } catch (error) {
                    addLog(`[Story] agent:event handler error: ${error instanceof Error ? error.message : String(error)}`);
                }
            };

            if (options?.eventBus && options?.messageStore) {
                options.eventBus.on('agent:text', agentTextHandler);
                options.eventBus.on('agent:event', agentEventHandler);
                listenersRegistered = true;
            }

            const enhancedContext: AgentStartContext = {
                ...context,
                tabExecutor: options?.tabExecutor,
            } as AgentStartContext & AgentContext & { tabExecutor?: any };

            const handle = startPrompt(userInput, enhancedContext, sinks);

            handle.completion.finally(() => {
                handleCompleted = true;
                if (!cleanupDeferred || activeChildAgents.size === 0) {
                    cleanup();
                } else {
                    addLog('[Story] Deferring listener cleanup until child agents finish');
                }
            });

            return handle;
        },
    };
}
