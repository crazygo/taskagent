/**
 * SummarizerAgent - Progress Summary Generator
 * 
 * A PromptAgent that generates concise progress summaries from event logs.
 * Used by SummarizationCallback to provide real-time progress updates.
 */

import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../../runtime/types.js';
import { buildPromptAgentStart } from '../../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../../runtime/agentLoader.js';
import { addLog } from '@shared/logger';

const SUMMARIZER_AGENT_ID = 'summarizer';
const SUMMARIZER_DESCRIPTION = 'Generate concise progress summaries from event logs';

export class SummarizerAgent extends PromptAgent implements RunnableAgent {
    readonly id = SUMMARIZER_AGENT_ID;
    readonly description = SUMMARIZER_DESCRIPTION;

    protected readonly inputSchema = {
        events: z.string().describe('Formatted event logs to summarize'),
    };

    private systemPrompt?: string;

    async initialize() {
        const agentDir = path.dirname(fileURLToPath(import.meta.url));

        const { systemPrompt } = await loadAgentPipelineConfig(agentDir, {
            coordinatorFileName: 'summarizer.agent.md',
        });

        this.systemPrompt = systemPrompt;
        
        addLog(`[SummarizerAgent] Initialized with prompt length: ${this.systemPrompt?.length || 0}`);
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        // userInput is the formatted event logs
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

        const summarizerStart = buildPromptAgentStart({
            getPrompt: (input) => this.getPrompt(input, {
                sourceTabId: context.sourceTabId,
                workspacePath: context.workspacePath,
            }),
            getSystemPrompt: () => this.getSystemPrompt(),
        });

        return summarizerStart(userInput, context, sinks);
    }

    protected async execute(
        args: { events: string },
        context: AgentToolContext
    ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
        // When called as a tool, events are already formatted
        const events = args.events;
        
        addLog(`[SummarizerAgent] Summarizing ${events.length} chars of events`);

        // For direct .start() calls, the input is already the formatted events
        return {
            content: [{ type: 'text', text: events }],
        };
    }
}

export async function createSummarizerAgent(): Promise<RunnableAgent> {
    const agent = new SummarizerAgent();
    await agent.initialize();
    return agent;
}
