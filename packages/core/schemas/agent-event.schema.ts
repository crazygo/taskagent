/**
 * Agent Event Schema - Zod validation for Event Bus protocol
 */

import { z } from 'zod';

export const AgentEventSchema = z.object({
    type: z.enum([
        'agent:text',
        'agent:reasoning',
        'agent:event',
        'agent:completed',
        'agent:failed',
        'message:added'
    ]),
    agentId: z.string().min(1),
    tabId: z.string().min(1),
    timestamp: z.number().positive(),
    payload: z.unknown(),
    version: z.literal('1.0')
});

// Export type from schema
export type AgentEventSchemaType = z.infer<typeof AgentEventSchema>;

