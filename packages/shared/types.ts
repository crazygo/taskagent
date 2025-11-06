export type MessageType = 'user' | 'assistant' | 'system';

export interface Message {
    id: number;
    role: MessageType;
    content: string;
    isBoxed?: boolean;
    isPending?: boolean;
    reasoning?: string;
}

export type LogMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

// Task event types for background tasks
export type TaskEventLevel = 'info' | 'warning' | 'error';

export interface TaskEvent {
    level: TaskEventLevel;
    message: string;
    ts: number;
}
