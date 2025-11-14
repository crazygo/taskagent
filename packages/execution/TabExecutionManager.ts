/**
 * Tab Execution Manager - Concurrent execution control at tab level
 * 
 * This manager ensures that each tab can only execute one agent at a time,
 * queuing additional requests until the current execution completes.
 * 
 * Key responsibilities:
 * - Track execution state per tab (idle/busy)
 * - Queue concurrent requests
 * - Process queue when tab becomes idle
 * - Store session state per tab
 * 
 * Design principles:
 * - One execution per tab at a time
 * - FIFO queue for fairness
 * - Independent state per tab
 * - Session management per tab
 */

import type { 
    TabExecutionState, 
    QueuedExecution, 
    ExecutionContext,
    ExecutorFn,
    ExecutionResult,
    SessionContext
} from './types.js';

export class TabExecutionManager {
    private tabStates = new Map<string, TabExecutionState>();

    /**
     * Get execution state for a tab, creating it if needed
     */
    getState(tabId: string): TabExecutionState {
        let state = this.tabStates.get(tabId);
        if (!state) {
            state = {
                status: 'idle',
                queue: [],
                currentExecution: null,
                session: null,
            };
            this.tabStates.set(tabId, state);
        }
        return state;
    }

    /**
     * Check if a tab is currently idle (not executing)
     */
    isIdle(tabId: string): boolean {
        return this.getState(tabId).status === 'idle';
    }

    /**
     * Get session for a tab
     */
    getSession(tabId: string): SessionContext | null {
        return this.getState(tabId).session;
    }

    /**
     * Set session for a tab
     */
    setSession(tabId: string, session: SessionContext): void {
        const state = this.getState(tabId);
        state.session = session;
    }

    /**
     * Execute an agent on a tab
     * 
     * If the tab is busy, the request is queued.
     * If the tab is idle, execution starts immediately.
     * 
     * @returns Promise that resolves when execution completes
     */
    async execute(
        tabId: string,
        agentId: string,
        userInput: string,
        context: ExecutionContext,
        executor: ExecutorFn
    ): Promise<ExecutionResult> {
        const state = this.getState(tabId);

        // If busy, queue the request
        if (state.status === 'busy') {
            return new Promise((resolve, reject) => {
                state.queue.push({
                    agentId,
                    userInput,
                    context,
                    resolve: (success) => resolve({ success }),
                    reject,
                });
            });
        }

        // Execute immediately
        return this.executeImmediate(tabId, agentId, userInput, context, executor);
    }

    /**
     * Execute immediately (tab is idle)
     */
    private async executeImmediate(
        tabId: string,
        agentId: string,
        userInput: string,
        context: ExecutionContext,
        executor: ExecutorFn
    ): Promise<ExecutionResult> {
        const state = this.getState(tabId);

        // Mark as busy
        state.status = 'busy';

        try {
            // Execute the agent
            const result = await executor(agentId, userInput, context);

            // Update session if provided
            if (result.sessionId) {
                state.session = {
                    id: result.sessionId,
                    initialized: true,
                };
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            // Mark as idle
            state.status = 'idle';
            state.currentExecution = null;

            // Process next queued execution
            await this.processQueue(tabId, executor);
        }
    }

    /**
     * Process the next item in the queue
     */
    private async processQueue(tabId: string, executor: ExecutorFn): Promise<void> {
        const state = this.getState(tabId);

        // If queue is empty, nothing to do
        if (state.queue.length === 0) {
            return;
        }

        // Take next item from queue
        const next = state.queue.shift()!;

        // Execute it
        try {
            const result = await this.executeImmediate(
                tabId,
                next.agentId,
                next.userInput,
                next.context,
                executor
            );
            next.resolve(result.success);
        } catch (error) {
            next.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    /**
     * Cancel all pending executions for a tab
     */
    cancelQueue(tabId: string): void {
        const state = this.getState(tabId);
        
        // Reject all queued items
        for (const item of state.queue) {
            item.reject(new Error('Execution cancelled'));
        }
        
        // Clear queue
        state.queue = [];
    }

    /**
     * Get queue length for a tab
     */
    getQueueLength(tabId: string): number {
        return this.getState(tabId).queue.length;
    }

    /**
     * Get statistics for debugging
     */
    getStats(): {
        totalTabs: number;
        busyTabs: number;
        totalQueued: number;
        tabDetails: Record<string, { status: string; queued: number }>;
    } {
        const stats = {
            totalTabs: this.tabStates.size,
            busyTabs: 0,
            totalQueued: 0,
            tabDetails: {} as Record<string, { status: string; queued: number }>,
        };

        for (const [tabId, state] of this.tabStates.entries()) {
            if (state.status === 'busy') {
                stats.busyTabs++;
            }
            stats.totalQueued += state.queue.length;
            stats.tabDetails[tabId] = {
                status: state.status,
                queued: state.queue.length,
            };
        }

        return stats;
    }

    /**
     * Clear all state (for testing)
     */
    clear(): void {
        this.tabStates.clear();
    }
}

