/**
 * Execution Layer - Coordinated agent execution
 * 
 * This package provides the execution coordination layer that decouples
 * agent execution from UI rendering. It includes:
 * 
 * - TabExecutor: Main entry point for executing agents
 * - TabExecutionManager: Concurrent execution control per tab
 * - MessageAdapter: Converts agent callbacks to EventBus events
 * 
 * Usage:
 * ```typescript
 * import { TabExecutor, TabExecutionManager } from '@taskagent/execution';
 * 
 * const manager = new TabExecutionManager();
 * const executor = new TabExecutor(manager, agentRegistry, eventBus);
 * 
 * await executor.execute('Story', 'story', 'Write a story', context);
 * ```
 */

export { TabExecutor } from './TabExecutor.js';
export { TabExecutionManager } from './TabExecutionManager.js';
export { MessageAdapter, createMessageAdapter } from './MessageAdapter.js';

export type {
    ExecutionContext,
    SessionContext,
    TabExecutionState,
    QueuedExecution,
    ExecutionResult,
    ExecutorFn,
} from './types.js';

