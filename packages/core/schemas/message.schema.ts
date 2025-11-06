/**
 * Message Schema - Zod validation for Message protocol
 */

import { z } from 'zod';

export const MessageSchema = z.object({
    id: z.number(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    sourceTabId: z.string().min(1),  // Required in v2.0
    timestamp: z.number().positive(), // Required in v2.0
    reasoning: z.string().optional(),
    isBoxed: z.boolean().optional(),
    isPending: z.boolean().optional()
});

// Export type from schema
export type MessageSchemaType = z.infer<typeof MessageSchema>;

