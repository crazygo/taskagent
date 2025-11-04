/**
 * Message Type - Core protocol for all messages in TaskAgent
 * 
 * In v2.0 Monorepo architecture, Message is the central data structure.
 * sourceTabId and timestamp are REQUIRED for proper Tab isolation.
 */

export interface Message {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    
    // v2.0: Required fields for Tab isolation
    sourceTabId: string;     // Which Tab this message belongs to
    timestamp: number;        // When this message was created
    
    // Optional fields
    reasoning?: string;       // AI reasoning (Claude thinking)
    isBoxed?: boolean;        // Should be rendered in a box (errors)
    isPending?: boolean;      // Is this a pending message (streaming)
}

export type MessageRole = Message['role'];

