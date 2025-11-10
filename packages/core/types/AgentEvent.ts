/**
 * Agent Event Types - Event Bus protocol
 * 
 * All Agent-to-UI communication happens through these events.
 * Agents emit events, CLI subscribes and updates UI.
 */

export type AgentEventType = 
    | 'agent:text'          // Text chunk from Agent
    | 'agent:reasoning'     // Reasoning/thinking text
    | 'agent:event'         // Task event (info/warning/error)
    | 'agent:completed'     // Agent execution completed
    | 'agent:failed'        // Agent execution failed
    | 'message:added'       // Message added to MessageStore (cross-tab communication)
    | 'task:progress'       // Async task progress update
    | 'task:result';        // Async task result

export interface AgentEvent {
    type: AgentEventType;
    agentId: string;        // Which Agent emitted this
    tabId: string;          // Which Tab this event belongs to
    timestamp: number;
    payload: unknown;       // Event-specific payload
    version: '1.0';         // Protocol version (fixed, no wildcards)
    parentAgentId?: string; // Parent agent in call chain (e.g., 'devhub' calls 'looper')
}

// Event-specific payload types
export interface AgentTextPayload {
    chunk: string;
}

export interface AgentReasoningPayload {
    reasoning: string;
}

export interface AgentEventPayload {
    level: 'info' | 'warning' | 'error';
    message: string;
}

export interface AgentCompletedPayload {
    fullText: string;
    sessionId?: string;
}

export interface AgentFailedPayload {
    error: string;
    code?: string;
}

export interface MessageAddedPayload {
    tabId: string;
    message: {
        id: number;
        role: string;
        content: string;
        isPending?: boolean;
        queueState?: string;
        isBoxed?: boolean;
    };
}

