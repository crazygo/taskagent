/**
 * Execution module types
 * 
 * Provides types for tab execution and agent coordination
 */

import type { ExecutionHandle, AgentStartSinks } from '@agents/runtime/types.js';

/**
 * Execution context passed to agents
 */
export interface ExecutionContext {
    sourceTabId: string;
    workspacePath?: string;
    session?: SessionContext;
    // Claude Agent SDK expects the full PermissionResult signature (see docs https://docs.claude.com/en/api/agent-sdk/typescript.md), so we pass the sinks-level handler verbatim.
    canUseTool?: AgentStartSinks['canUseTool'];
    parentAgentId?: string;  // Parent agent in call chain (for agent hierarchy tracking)
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
