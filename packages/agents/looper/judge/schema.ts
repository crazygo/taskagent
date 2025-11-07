/**
 * JUDGE Decision Schema
 * 
 * Defines the structured output format for JUDGE Agent decisions.
 */

import { z } from 'zod';

export const JudgeDecisionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('continue'),
    nextTask: z.string().describe('整合后的新任务描述，包含review问题和pending任务'),
    reason: z.string().describe('为什么继续循环的理由'),
  }),
  z.object({
    type: z.literal('terminate'),
    reason: z.string().describe('为什么终止循环的理由'),
  }),
]);

export type JudgeDecision = z.infer<typeof JudgeDecisionSchema>;
