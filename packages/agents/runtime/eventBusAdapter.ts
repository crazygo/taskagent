/**
 * Event Bus Adapter for Agents
 * 
 * Converts Agent callbacks (AgentStartSinks) to EventBus events,
 * decoupling agents from UI dependencies.
 */

import type { EventBus } from '@taskagent/core/event-bus/index.js';
import type { AgentStartSinks } from './types.js';

export interface EventBusAdapterOptions {
    eventBus: EventBus;
    agentId: string;
    tabId: string;
}

/**
 * Creates AgentStartSinks that emit events to the EventBus
 * instead of directly updating UI state.
 */
export function createEventBusAdapter(
    options: EventBusAdapterOptions,
    canUseTool: AgentStartSinks['canUseTool']
): AgentStartSinks {
    const { eventBus, agentId, tabId } = options;

    return {
        // Text output from agent
        onText: (chunk: string) => {
            eventBus.emit({
                type: 'agent:text',
                agentId,
                tabId,
                timestamp: Date.now(),
                payload: chunk,
                version: '1.0',
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

        // Tool permission callback - pass through from driver
        canUseTool,

        // Session ID callback (optional)
        onSessionId: (sessionId: string) => {
            // Can emit a session event if needed
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

