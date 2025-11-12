import type { RunnableAgent, AgentStartContext, AgentStartSinks, ExecutionHandle } from '../runtime/types.js';
import { BaseAgent } from '../runtime/types.js';
import type { AgentCallback } from './AgentCallback.js';
import { addLog } from '@taskagent/shared/logger';

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
export abstract class LoopAgent extends BaseAgent implements RunnableAgent {
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
     * Current context for accessing sourceTabId, parentAgentId, etc.
     */
    protected currentContext?: AgentStartContext;

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
     * Start loop execution (Template Method)
     */
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.currentSinks = sinks;
        this.currentContext = context;
        
        // Start loop asynchronously
        this.runLoopAsync(userInput, context, sinks).catch(error => {
            addLog(`[${this.id}] Error: ${error}`);
            sinks.onText?.(`❌ 执行失败: ${error}`);
            sinks.onCompleted?.('');
        });

        return {
            cancel: () => { this.state.shouldStop = true; },
            sessionId: this.id,
            completion: Promise.resolve(true)
        };
    }

    /**
     * Template Method - defines the loop algorithm skeleton
     * Subclasses implement runSinglePass() and shouldContinue()
     */
    private async runLoopAsync(
        userInput: string,
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<void> {
        // Initialize state
        this.state.status = 'RUNNING';
        this.state.currentTask = userInput;
        this.state.iteration = 0;
        
        addLog(`[${this.id}] Starting loop`);
        
        // Hook: before loop
        await this.beforeLoop?.(context, sinks);
        
        // Main loop
        while (this.state.iteration < this.maxIterations && !this.state.shouldStop) {
            this.state.iteration++;
            addLog(`[${this.id}] Iteration ${this.state.iteration}/${this.maxIterations}`);
            
            // Hook: iteration start
            await this.onIterationStart?.(this.state.iteration, context, sinks);
            
            // Execute single iteration (abstract method - implemented by subclass)
            const result = await this.runSinglePass(context, sinks);
            
            // Hook: iteration end
            await this.onIterationEnd?.(this.state.iteration, result, context, sinks);
            
            // Decide whether to continue (abstract method - implemented by subclass)
            const decision = await this.shouldContinue(result);
            
            if (!decision.continue) {
                addLog(`[${this.id}] Stopping: ${decision.reason}`);
                // Hook: completion
                await this.onComplete?.(decision, sinks);
                break;
            }
            
            if (decision.nextTask) {
                this.state.currentTask = decision.nextTask;
                // Hook: retry
                await this.onRetry?.(decision, sinks);
            }
        }
        
        // Check if max iterations reached
        if (this.state.iteration >= this.maxIterations && !this.state.shouldStop) {
            addLog(`[${this.id}] Max iterations reached`);
            await this.onMaxIterations?.(sinks);
        }
        
        // Hook: after loop
        await this.afterLoop?.(context, sinks);
        
        this.state.status = 'IDLE';
        sinks.onCompleted?.('Loop completed');
    }

    /**
     * Execute a single iteration (abstract method - subclass must implement)
     * 
     * @param context - Execution context
     * @param sinks - Event sinks for output
     * @returns Result of this iteration (passed to shouldContinue)
     */
    protected abstract runSinglePass(
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<string>;

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

    // ========================================
    // Hook Methods (optional - subclass can override)
    // ========================================

    /**
     * Called before loop starts
     */
    protected async beforeLoop?(
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<void>;

    /**
     * Called after loop ends
     */
    protected async afterLoop?(
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<void>;

    /**
     * Called before each iteration starts
     */
    protected async onIterationStart?(
        iteration: number,
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<void>;

    /**
     * Called after each iteration completes
     */
    protected async onIterationEnd?(
        iteration: number,
        result: string,
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): Promise<void>;

    /**
     * Called when loop completes successfully
     */
    protected async onComplete?(
        decision: { continue: boolean; nextTask?: string; reason: string },
        sinks: AgentStartSinks
    ): Promise<void>;

    /**
     * Called when preparing to retry (decision.continue = true && decision.nextTask exists)
     */
    protected async onRetry?(
        decision: { continue: boolean; nextTask?: string; reason: string },
        sinks: AgentStartSinks
    ): Promise<void>;

    /**
     * Called when max iterations reached
     */
    protected async onMaxIterations?(
        sinks: AgentStartSinks
    ): Promise<void>;

    // Legacy hooks (deprecated - use new hooks above)
    protected onLoopStart?(task: string): void;
    protected onLoopEnd?(reason: string): void;
}
