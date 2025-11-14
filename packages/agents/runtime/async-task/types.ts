/**
 * AsyncTask - Shared types for async task execution
 */

import type { AgentRegistry } from '../../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';

/**
 * Context passed to async tasks
 */
export interface AsyncTaskContext {
    agentRegistry: AgentRegistry;
    eventBus: EventBus;
    tabExecutor: any;
    workspacePath?: string;
    sourceTabId: string;
    parentAgentId: string;
}

/**
 * Handle returned from async task execution
 */
export interface AsyncTaskHandle {
    taskId: string;
    cancel: () => void;
    completion: Promise<boolean>;
}
