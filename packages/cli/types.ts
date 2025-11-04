export type MessageType = 'user' | 'assistant' | 'system';

export interface Message {
    id: number;
    role: MessageType;
    content: string;
    isBoxed?: boolean;
    isPending?: boolean;
    reasoning?: string;
    sourceTabId?: string;      // Tab isolation support
    timestamp?: number;         // Event timestamp
}

export type LogMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

// Task event types for background tasks - re-exported from @taskagent/core
export type { TaskEvent, TaskEventLevel } from '@taskagent/core/types/TaskEvent.js';
