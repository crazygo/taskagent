/**
 * SummarizationCallback - Observe workflow events and generate progress summaries
 * 
 * Extracts summarization logic from CodingLoop following ADK Callback pattern.
 * Manages event collection, timing, and summary generation as a pluggable observer.
 */

import type { AgentCallback } from '../../workflow-agents/AgentCallback.js';
import type { RunnableAgent } from '../../runtime/types.js';
import { EventCollector } from './event-collector.js';
import { addLog } from '@shared/logger';

export class SummarizationCallback implements AgentCallback {
    private eventCollector = new EventCollector();
    private summaryTimer?: NodeJS.Timeout;

    constructor(
        private summarizerAgent: RunnableAgent,
        private onSummary: (summary: string) => void
    ) {}

    /**
     * Called when an agent uses a tool
     */
    onToolUse(agentId: string, _toolName: string, event: any): void {
        this.eventCollector.add(event);
        
        // Trigger summary if threshold reached
        if (this.eventCollector.shouldSummarize()) {
            this.triggerSummary(agentId).catch(err => {
                addLog(`[SummarizationCallback] Summary generation failed: ${err}`);
            });
        }
    }

    /**
     * Called when an agent emits text
     */
    onText(agentId: string, chunk: string): void {
        this.eventCollector.add({ type: 'text', content: chunk });
    }

    /**
     * Called when an agent completes execution
     */
    onAgentEnd(agentId: string, _result: string): void {
        this.stopTimer();
        
        // Generate final summary if there are events
        if (this.eventCollector.hasEvents()) {
            this.triggerSummary(agentId).catch(err => {
                addLog(`[SummarizationCallback] Final summary failed: ${err}`);
            });
        }
    }

    /**
     * Start periodic summary timer (30s)
     */
    startTimer(agentId: string): void {
        this.summaryTimer = setInterval(() => {
            if (this.eventCollector.hasEvents()) {
                this.triggerSummary(agentId).catch(err => {
                    addLog(`[SummarizationCallback] Timer summary failed: ${err}`);
                });
            }
        }, 30000);
    }

    /**
     * Stop periodic summary timer
     */
    stopTimer(): void {
        if (this.summaryTimer) {
            clearInterval(this.summaryTimer);
            this.summaryTimer = undefined;
        }
    }

    /**
     * Generate summary from collected events
     */
    private async triggerSummary(agentId: string): Promise<void> {
        const events = this.eventCollector.flush();
        if (events.length === 0) return;

        try {
            addLog(`[SummarizationCallback] Generating summary for ${events.length} events`);
            
            const prompt = this.buildSummaryPrompt(events);
            const summary = await this.callSummarizer(prompt);
            
            if (summary) {
                this.onSummary(`[${agentId}] ${summary}`);
            }
        } catch (error) {
            addLog(`[SummarizationCallback] Summary error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Build prompt for summarizer from events
     */
    private buildSummaryPrompt(events: any[]): string {
        const tools: string[] = [];
        const texts: string[] = [];

        for (const event of events) {
            if (event.data?.type === 'tool_use') {
                const tool = event.data;
                const name = tool.name;
                const input = tool.input || {};
                
                // Format tool call
                let toolDesc = `- ${name}`;
                if (input.file_path) toolDesc += ` ${input.file_path}`;
                if (input.command) toolDesc += `: ${input.command}`;
                if (input.content) toolDesc += ` (content truncated)`;
                
                tools.push(toolDesc);
            } else if (event.data?.type === 'text' && event.data?.content) {
                texts.push(`- "${event.data.content}"`);
            }
        }

        let prompt = '';
        if (tools.length > 0) {
            prompt += 'Tools:\n' + tools.join('\n') + '\n\n';
        }
        if (texts.length > 0) {
            prompt += 'Text:\n' + texts.join('\n') + '\n\n';
        }

        if (!prompt) {
            prompt = 'Agent is processing...\n\n';
        }

        return prompt;
    }

    /**
     * Call summarizer agent to generate summary
     */
    private async callSummarizer(prompt: string): Promise<string> {
        return new Promise((resolve) => {
            let summary = '';
            
            const handle = this.summarizerAgent.start(
                prompt,
                { sourceTabId: 'SummarizationCallback', workspacePath: undefined },
                {
                    onText: (chunk: string) => {
                        summary += chunk;
                    },
                    onReasoning: () => {},
                    onEvent: () => {},
                    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                }
            );

            handle.completion.then(() => {
                resolve(summary.trim());
            }).catch((err) => {
                addLog(`[SummarizationCallback] Summarizer execution failed: ${err}`);
                resolve('');
            });
        });
    }
}
