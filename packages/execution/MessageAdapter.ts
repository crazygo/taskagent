/**
 * Message Adapter - Converts Agent callbacks to EventBus events
 * 
 * This adapter decouples agents from UI by translating agent output
 * (via AgentStartSinks callbacks) into EventBus events that the UI
 * can subscribe to.
 * 
 * Key responsibilities:
 * - Text output → agent:text event
 * - Reasoning → agent:reasoning event
 * - System events → agent:event event
 * - Completion → agent:completed event
 * - Errors → agent:failed event
 */

import type { EventBus } from '@taskagent/core/event-bus';
import type { AgentStartSinks } from '@taskagent/agents/runtime/types.js';
import { addLog } from '../shared/logger.js';

export interface MessageAdapterOptions {
    eventBus: EventBus;
    agentId: string;
    tabId: string;
}

/**
 * Creates AgentStartSinks that emit events to the EventBus
 * instead of directly updating UI state.
 * 
 * This is the core decoupling mechanism between agents and UI.
 */
export class MessageAdapter {
    constructor(
        private tabId: string,
        private agentId: string,
        private eventBus: EventBus,
        private context?: { parentAgentId?: string }
    ) {}

    /**
     * Create AgentStartSinks callbacks that emit to EventBus
     */
    createSinks(canUseTool: AgentStartSinks['canUseTool']): AgentStartSinks {
        const { eventBus, agentId, tabId } = this;

        return {
            // Text output from agent
            onText: (chunk: string) => {
                addLog(`[MessageAdapter] onText called for agent=${agentId} tab=${tabId} chunk.length=${chunk.length} parentAgentId=${this.context?.parentAgentId}`);
                eventBus.emit({
                    type: 'agent:text',
                    agentId,
                    tabId,
                    timestamp: Date.now(),
                    payload: chunk,
                    version: '1.0',
                    parentAgentId: this.context?.parentAgentId,
                });
            },

            // Reasoning/thinking process
            onReasoning: (chunk: string) => {
                eventBus.emit({
                    type: 'agent:reasoning',
                    agentId,
                    tabId,
                    timestamp: Date.now(),
                    payload: chunk,
                    version: '1.0',
                });
            },

            // System events (info, warning, error)
            onEvent: (event) => {
                eventBus.emit({
                    type: 'agent:event',
                    agentId,
                    tabId,
                    timestamp: Date.now(),
                    payload: event,
                    version: '1.0',
                });
            },

            // Agent completed successfully
            onCompleted: (fullText: string) => {
                eventBus.emit({
                    type: 'agent:completed',
                    agentId,
                    tabId,
                    timestamp: Date.now(),
                    payload: fullText,
                    version: '1.0',
                });
            },

            // Agent failed with error
            onFailed: (error: string) => {
                eventBus.emit({
                    type: 'agent:failed',
                    agentId,
                    tabId,
                    timestamp: Date.now(),
                    payload: error,
                    version: '1.0',
                });
            },

            // Tool permission callback - pass through from context
            canUseTool,

            // Session ID callback (optional)
            onSessionId: (sessionId: string) => {
                // Emit a session event
                eventBus.emit({
                    type: 'agent:event',
                    agentId,
                    tabId,
                    timestamp: Date.now(),
                    payload: { type: 'session', sessionId },
                    version: '1.0',
                });
            },
        };
    }
}

/**
 * Factory function for creating MessageAdapter (for backward compatibility)
 */
export function createMessageAdapter(
    options: MessageAdapterOptions,
    canUseTool: AgentStartSinks['canUseTool']
): AgentStartSinks {
    const adapter = new MessageAdapter(
        options.tabId,
        options.agentId,
        options.eventBus
    );
    return adapter.createSinks(canUseTool);
}

