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
