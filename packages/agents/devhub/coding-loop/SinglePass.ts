/**
 * SinglePass - Execute one iteration of Coder → Reviewer workflow
 * 
 * Represents a single iteration in the DevHub coding loop.
 * Executes Coder and Reviewer agents sequentially.
 */

import { SequentialAgent } from '../../workflow-agents/SequentialAgent.js';
import type { RunnableAgent } from '../../runtime/types.js';

export class SinglePass extends SequentialAgent {
    readonly id = 'single-pass';
    readonly description = 'Execute one iteration of Coder→Reviewer workflow';

    protected readonly failFast = false; // Continue to Reviewer even if Coder fails
    protected readonly contextMode = 'none' as const; // Each agent uses original task

    constructor(
        private coderAgent: RunnableAgent,
        private reviewerAgent: RunnableAgent
    ) {
        super();
    }

    protected get subAgents(): RunnableAgent[] {
        return [this.coderAgent, this.reviewerAgent];
    }

    /**
     * Aggregate Coder and Reviewer outputs
     */
    protected aggregateResults(results: string[]): string {
        return JSON.stringify({
            coderOutput: results[0] || '',
            reviewerOutput: results[1] || '',
        });
    }
}
