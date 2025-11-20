/**
 * JudgeAgent - Loop Decision Maker
 * 
 * A PromptAgent that analyzes iteration results and decides whether to:
 * - Continue the loop with updated task
 * - Terminate the loop with final result
 */

import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../../runtime/types.js';
import { buildPromptAgentStart } from '../../runtime/runPromptAgentStart.js';
import { JudgeDecisionSchema, type JudgeDecision } from './schema.js';
import { addLog } from '@shared/logger';
import fs from 'fs/promises';

const JUDGE_AGENT_ID = 'judge';
const JUDGE_DESCRIPTION = 'Loop decision maker - analyzes iteration results and decides continuation';

export class JudgeAgent extends PromptAgent implements RunnableAgent {
    readonly id = JUDGE_AGENT_ID;
    readonly description = JUDGE_DESCRIPTION;

    protected readonly inputSchema = {
        currentTask: z.string().describe('Current task being executed'),
        iteration: z.number().describe('Current iteration number'),
        iterationResult: z.string().describe('Result from this iteration'),
        pendingMessages: z.array(z.string()).optional().describe('Pending messages from user'),
    };

    private systemPrompt?: string;

    async initialize() {
        // With --splitting, directory structure is preserved
        // JudgeAgent.js and judge.agent.md are in the same directory
        const agentDir = path.dirname(fileURLToPath(import.meta.url));
        const systemPromptPath = path.join(agentDir, 'judge.agent.md');
        
        this.systemPrompt = await fs.readFile(systemPromptPath, 'utf-8');
        
        addLog(`[JudgeAgent] Loaded from: ${systemPromptPath}`);
        addLog(`[JudgeAgent] Initialized with prompt length: ${this.systemPrompt.length}`);
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        // userInput is already formatted by caller (CodingLoop.shouldContinue)
        return userInput.trim();
    }

    getSystemPrompt(): string {
        return this.systemPrompt || '';
    }

    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
        };
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.setRuntimeContext({
            sourceTabId: context.sourceTabId,
            workspacePath: context.workspacePath,
            parentAgentId: context.parentAgentId,
        });

        const judgeStart = buildPromptAgentStart({
            getPrompt: (input) => this.getPrompt(input, {
                sourceTabId: context.sourceTabId,
                workspacePath: context.workspacePath,
            }),
            getSystemPrompt: () => this.getSystemPrompt(),
        });

        return judgeStart(userInput, context, sinks);
    }

    protected async execute(
        args: {
            currentTask: string;
            iteration: number;
            iterationResult: string;
            pendingMessages?: string[];
        },
        context: AgentToolContext
    ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
        // Format input for LLM
        const prompt = `
Current Task: ${args.currentTask}
Iteration: ${args.iteration}

Iteration Result:
${args.iterationResult}

Pending Messages (${args.pendingMessages?.length || 0}):
${args.pendingMessages?.map((m, i) => `${i + 1}. ${m}`).join('\n') || '(无)'}
`.trim();

        addLog(`[JudgeAgent] Analyzing iteration ${args.iteration}`);

        // This method is called when JudgeAgent is used as a tool
        // For direct .start() calls, the prompt is already formatted
        return {
            content: [{ type: 'text', text: prompt }],
        };
    }

    /**
     * Parse JUDGE output into structured decision
     */
    parseOutput(rawOutput: string): any {
        try {
            // Try to extract JSON from markdown code blocks
            const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch?.[1] || rawOutput;
            
            const parsed = JSON.parse(jsonStr.trim());
            return JudgeDecisionSchema.parse(parsed);
        } catch (error) {
            addLog(`[JudgeAgent] Failed to parse output: ${error}`);
            // Fallback: terminate on parse error
            return {
                type: 'terminate',
                reason: `解析决策失败: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
}

export async function createJudgeAgent(): Promise<RunnableAgent> {
    const agent = new JudgeAgent();
    await agent.initialize();
    return agent;
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
        addLog(`[parseJudgeOutput] Failed to parse: ${error}`);
        // Fallback: terminate on parse error
        return {
            type: 'terminate',
            reason: `解析决策失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
