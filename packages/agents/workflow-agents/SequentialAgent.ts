import type { RunnableAgent, AgentStartContext, AgentStartSinks, ExecutionHandle } from '../runtime/types.js';

/**
 * SequentialAgent - Execute a group of sub-agents in sequence
 * 
 * Responsibilities:
 * - Execute sub_agents in defined order
 * - Pass output from previous agent to next agent (optional)
 * - Collect and aggregate results from all sub-agents
 * - Provide unified event stream (onText/onEvent) to caller
 * 
 * Design patterns:
 * - Subclass defines sub_agents list (fixed order)
 * - run() method calls each sub-agent's start() in sequence
 * - Support short-circuit: choose to terminate or continue on sub-agent failure
 * - Output aggregation: can be last agent's output or combination of all outputs
 */
export abstract class SequentialAgent implements RunnableAgent {
    abstract readonly id: string;
    abstract readonly description: string;

    /**
     * List of sub-agents (execution order)
     * Subclass must implement this property
     */
    protected abstract readonly subAgents: RunnableAgent[];

    /**
     * Whether to terminate immediately on sub-agent failure
     * Default: true (fail fast)
     */
    protected readonly failFast: boolean = true;

    /**
     * How to pass context:
     * - 'output': Use previous agent's output as next agent's input
     * - 'accumulate': Accumulate all outputs and pass them
     * - 'none': Each agent uses original input
     */
    protected readonly contextMode: 'output' | 'accumulate' | 'none' = 'none';

    /**
     * Start sequential execution flow
     */
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        // TODO: Implement sequential execution logic
        // 1. Iterate through subAgents
        // 2. Call each agent.start() sequentially
        // 3. Wait for previous agent to complete before starting next
        // 4. Decide how to pass input based on contextMode
        // 5. Aggregate event stream and forward to sinks
        // 6. Handle cancel signal (need to interrupt currently executing sub-agent)
        
        throw new Error('SequentialAgent.start() not implemented');
    }

    /**
     * Subclass can override this method to customize result aggregation logic
     * @param results - Output from each sub-agent
     * @returns Final output
     */
    protected aggregateResults(results: string[]): string {
        // Default: return last result
        return results[results.length - 1] || '';
    }

    /**
     * Subclass can override this method to handle sub-agent failure
     * @param agentId - ID of failed agent
     * @param error - Error message
     * @returns Whether to continue executing subsequent agents
     */
    protected onSubAgentFailed(agentId: string, error: string): boolean {
        // Default: follow failFast configuration
        return !this.failFast;
    }
}
