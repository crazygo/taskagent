export type MessageType = 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';

export interface Message {
    id: number;
    role: MessageType;
    content: string;
    isBoxed?: boolean;
    isPending?: boolean;
    reasoning?: string;
    sourceTabId?: string;      // Tab isolation support
    timestamp?: number;         // Event timestamp
    variant?: 'default' | 'worker';
    // Tool call specific fields
    toolName?: string;          // Tool name (e.g., "Bash", "Read")
    toolId?: string;            // Tool call ID for tracking
    toolDescription?: string;   // Human-readable description of the tool action
    toolIsError?: boolean;      // Whether tool execution failed
    durationMs?: number;        // Execution time (for tool_result)
    queueState?: 'queued' | 'active' | 'completed';
}

export type LogMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

// Task event types for background tasks - re-exported from @taskagent/core
export type { TaskEvent, TaskEventLevel } from '@taskagent/core/types/TaskEvent.js';
