/**
 * JUDGE Agent - Looper 循环决策者
 * 
 * 基于 PromptAgent 实现的决策节点，使用 LLM 分析并决策是否继续循环。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { buildPromptAgentStart } from '../../../runtime/runPromptAgentStart.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../../../runtime/types.js';
import { JudgeDecisionSchema, type JudgeDecision } from './schema.js';
import fs from 'fs/promises';

const JUDGE_AGENT_ID = 'judge';
const JUDGE_DESCRIPTION = 'Looper循环决策者，分析执行结果并决定是否继续';

export async function createJudgeAgent(): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));
    const systemPromptPath = path.join(agentDir, 'judge.agent.md');
    const systemPromptContent = await fs.readFile(systemPromptPath, 'utf-8');

    const getPrompt = (userInput: string) => userInput.trim();
    
    const getSystemPrompt = () => systemPromptContent;

    const start = buildPromptAgentStart({
        getPrompt,
        getSystemPrompt,
    });

    return {
        id: JUDGE_AGENT_ID,
        description: JUDGE_DESCRIPTION,
        getPrompt,
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => 
            start(userInput, context, sinks),
    };
}

/**
 * Helper function to parse JUDGE output into JudgeDecision
 */
export function parseJudgeOutput(rawOutput: string): JudgeDecision {
    try {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonMatch?.[1] || rawOutput;
        
        const parsed = JSON.parse(jsonStr.trim());
        return JudgeDecisionSchema.parse(parsed);
    } catch (error) {
        console.error('Failed to parse JUDGE output:', error);
        // Fallback: terminate on parse error
        return {
            type: 'terminate',
            reason: `解析决策失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
