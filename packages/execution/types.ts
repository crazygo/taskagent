/**
 * Execution Layer Types
 * 
 * Types for the execution coordination layer that decouples
 * Agent execution from UI rendering.
 */

import type { ExecutionHandle } from '@taskagent/agents/runtime/types.js';

/**
 * Execution context passed to agents
 */
export interface ExecutionContext {
    sourceTabId: string;
    workspacePath?: string;
    session?: SessionContext;
    canUseTool?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Session context for agent execution
 */
export interface SessionContext {
    id: string;
    initialized: boolean;
    fork?: boolean;  // Whether this is a forked session (for background tasks)
}

/**
 * Tab execution state
 * Tracks the execution status and queue for each tab
 */
export interface TabExecutionState {
    status: 'idle' | 'busy';
    queue: QueuedExecution[];
    currentExecution: ExecutionHandle | null;
    session: SessionContext | null;
}

/**
 * Queued execution waiting to be processed
 */
export interface QueuedExecution {
    agentId: string;
    userInput: string;
    context: ExecutionContext;
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
}

/**
 * Execution result
 */
export interface ExecutionResult {
    success: boolean;
    sessionId?: string;
    error?: string;
}

/**
 * Executor function type
 * Used by TabExecutionManager to delegate actual execution
 */
export type ExecutorFn = (
    agentId: string,
    userInput: string,
    context: ExecutionContext
) => Promise<ExecutionResult>;

