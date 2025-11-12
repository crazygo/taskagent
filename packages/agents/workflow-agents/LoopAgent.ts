import type { RunnableAgent, AgentStartContext, AgentStartSinks, ExecutionHandle } from '../runtime/types.js';
import type { AgentCallback } from './AgentCallback.js';

/**
 * LoopAgent - Execute sub-agents in a loop until termination condition is met
 * 
 * Responsibilities:
 * - Manage loop execution state (current iteration, task queue, etc.)
 * - Call sub_agents each iteration (typically a single SequentialAgent)
 * - Decide whether to continue based on decision agent (e.g., JudgeAgent) output
 * - Handle loop control commands (start/stop/status/add_pending)
 * - Support maximum iteration limit
 * 
 * Design patterns:
 * - Subclass defines sub_agents (typically a single SequentialAgent representing one iteration)
 * - run() method manages loop and state
 * - shouldContinue() decides whether to proceed to next iteration
 * - updateTask() updates next iteration's task based on previous iteration result
 */
export abstract class LoopAgent implements RunnableAgent {
    abstract readonly id: string;
    abstract readonly description: string;

    /**
     * List of sub-agents (work unit executed each iteration)
     * Typically a single SequentialAgent
     */
    protected abstract readonly subAgents: RunnableAgent[];

    /**
     * Callbacks for observing loop execution (pluggable observers)
     */
    protected callbacks: AgentCallback[] = [];

    /**
     * Current sinks for emitting events to parent agent
     */
    protected currentSinks?: AgentStartSinks;

    /**
     * Maximum iteration count (prevent infinite loop)
     */
    protected readonly maxIterations: number = 10;

    /**
     * Current loop state
     */
    protected state: {
        status: 'IDLE' | 'RUNNING';
        iteration: number;
        currentTask: string;
        shouldStop: boolean;
        pendingQueue: string[];
    } = {
        status: 'IDLE',
        iteration: 0,
        currentTask: '',
        shouldStop: false,
        pendingQueue: [],
    };

    /**
     * Attach a callback for observing loop execution
     */
    addCallback(callback: AgentCallback): void {
        this.callbacks.push(callback);
    }

    /**
     * Emit event to parent agent
     */
    protected emit(event: { type: string; payload: any }): void {
        this.currentSinks?.onEvent?.({
            level: 'info',
            message: `${this.id}:${event.type}`,
            ...event,
        } as any);
    }

    /**
     * Notify all callbacks of lifecycle event
     */
    protected notifyCallbacks(method: keyof AgentCallback, ...args: any[]): void {
        this.callbacks.forEach(cb => {
            const fn = cb[method] as any;
            if (typeof fn === 'function') {
                fn.call(cb, ...args);
            }
        });
    }

    /**
     * Start loop execution
     */
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.currentSinks = sinks; // Save for emit()
        
        // TODO: Implement loop control logic
        // 1. Parse command (start/stop/status/add_pending)
        // 2. Response path: return response immediately
        // 3. Execution path: start loop asynchronously
        // 4. Call subAgents[0].start() each iteration
        // 5. Call shouldContinue() after completion to decide whether to continue
        // 6. Support manual stop (shouldStop flag)
        
        throw new Error('LoopAgent.start() not implemented');
    }

    /**
     * Determine whether to continue to next iteration
     * Subclass must implement this method (typically based on JudgeAgent's decision)
     * 
     * @param iterationResult - Result of current iteration
     * @returns Decision object: { continue: boolean, nextTask?: string, reason: string }
     */
    protected abstract shouldContinue(
        iterationResult: string
    ): Promise<{ continue: boolean; nextTask?: string; reason: string }>;

    /**
     * Update task for next iteration
     * @param decision - Decision result from shouldContinue
     */
    protected updateTask(decision: { nextTask?: string }): void {
        if (decision.nextTask) {
            this.state.currentTask = decision.nextTask;
        }
    }

    /**
     * Called before loop starts (optional hook)
     */
    protected onLoopStart?(task: string): void;

    /**
     * Called before each iteration starts (optional hook)
     */
    protected onIterationStart?(iteration: number, task: string): void;

    /**
     * Called after each iteration completes (optional hook)
     */
    protected onIterationEnd?(iteration: number, result: string): void;

    /**
     * Called after loop ends (optional hook)
     */
    protected onLoopEnd?(reason: string): void;
}
