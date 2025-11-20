/**
 * Tab Executor - Main coordinator for agent execution
 * 
 * This is the central entry point for executing agents in the application.
 * It integrates:
 * - TabExecutionManager (concurrent control)
 * - AgentRegistry (agent instantiation)
 * - MessageAdapter (event conversion)
 * - EventBus (decoupling)
 * 
 * Key responsibilities:
 * - Coordinate agent execution
 * - Manage execution flow
 * - Handle errors gracefully
 * - Emit events to UI via EventBus
 * 
 * Usage from CLI:
 * ```typescript
 * const executor = new TabExecutor(tabExecManager, agentRegistry, eventBus);
 * await executor.execute('Story', 'story', 'Write a story', { ... });
 * ```
 */

import type { EventBus } from '@core/event-bus';
import type { AgentRegistry } from '@agents/registry/AgentRegistry.js';
import { TabExecutionManager } from './TabExecutionManager.js';
import { MessageAdapter } from './MessageAdapter.js';
import type { ExecutionContext, ExecutionResult } from './types.js';
import type { AgentStartSinks } from '@agents/runtime/types.js';

export class TabExecutor {
    constructor(
        private tabExecManager: TabExecutionManager,
        private agentRegistry: AgentRegistry,
        private eventBus: EventBus
    ) {}

    /**
     * Execute an agent on a specific tab
     * 
     * This is the main entry point for all agent executions.
     * It handles:
     * - Concurrent execution control via TabExecutionManager
     * - Agent instantiation via AgentRegistry
     * - Event emission via MessageAdapter + EventBus
     * 
     * @param tabId - Tab ID (e.g., 'Story', 'Glossary')
     * @param agentId - Agent ID (e.g., 'story', 'glossary')
     * @param userInput - User input/prompt
     * @param context - Execution context (workspace path, session, etc.)
     * @param options - Execution options (async: fire-and-forget)
     * @returns Promise that resolves when execution completes (or immediately if async)
     */
    async execute(
        tabId: string,
        agentId: string,
        userInput: string,
        context: ExecutionContext,
        options?: { async?: boolean }
    ): Promise<ExecutionResult> {
        // Delegate to TabExecutionManager for concurrent control
        return this.tabExecManager.execute(
            tabId,
            agentId,
            userInput,
            context,
            // Executor function that does the actual work
            async (aid, input, ctx) => {
                return this.executeAgent(tabId, aid, input, ctx, options?.async);
            }
        );
    }

    /**
     * Execute an agent immediately (called by TabExecutionManager)
     * 
     * This is the core execution logic:
     * 1. Get session from TabExecutionManager
     * 2. Create agent instance from AgentRegistry
     * 3. Create MessageAdapter for event conversion
     * 4. Start agent with sinks
     * 5. Await completion (or return immediately if async)
     */
    private async executeAgent(
        tabId: string,
        agentId: string,
        userInput: string,
        context: ExecutionContext,
        isAsync?: boolean
    ): Promise<ExecutionResult> {
        try {
            // Get session from TabExecutionManager if not provided
            if (!context.session) {
                const existingSession = this.tabExecManager.getSession(tabId);
                if (existingSession) {
                    context.session = existingSession;
                }
            }

            // Create agent instance
            const agent = await this.agentRegistry.createAgent(agentId);
            if (!agent) {
                throw new Error(`Agent '${agentId}' not found in registry`);
            }

            // Create MessageAdapter for event conversion
            const adapter = new MessageAdapter(
                tabId, 
                agentId, 
                this.eventBus,
                { parentAgentId: context.parentAgentId }
            );
            const sinks = adapter.createSinks(
                context.canUseTool || this.defaultCanUseTool
            );

            // Start agent
            const handle = await agent.start(userInput, context, sinks);
            
            // If async mode, don't wait for completion
            if (isAsync) {
                // Fire and forget - handle completion in background
                handle.completion.catch((error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.eventBus.emit({
                        type: 'agent:failed',
                        agentId,
                        tabId,
                        timestamp: Date.now(),
                        payload: errorMessage,
                        version: '1.0',
                    });
                });
                
                return {
                    success: true,
                    sessionId: handle.sessionId ?? context.session?.id,
                };
            }
            
            // Synchronous mode - wait for completion
            const completed = await handle.completion;

            return {
                success: completed,
                sessionId: handle.sessionId ?? context.session?.id,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Emit failure event
            this.eventBus.emit({
                type: 'agent:failed',
                agentId,
                tabId,
                timestamp: Date.now(),
                payload: errorMessage,
                version: '1.0',
            });

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Default tool permission handler
     * Always allows tools (can be overridden by context)
     */
    private defaultCanUseTool: AgentStartSinks['canUseTool'] = async (
        _toolName: string,
        input: Record<string, unknown>,
        _options: { signal: AbortSignal; suggestions?: any[] }
    ) => {
        // Auto-approve with a full PermissionResult object; booleans are invalid per https://docs.claude.com/en/api/agent-sdk/typescript.md.
        return {
            behavior: 'allow',
            updatedInput: input,
        };
    };

    /**
     * Check if a tab is idle
     */
    isIdle(tabId: string): boolean {
        return this.tabExecManager.isIdle(tabId);
    }

    /**
     * Get queue length for a tab
     */
    getQueueLength(tabId: string): number {
        return this.tabExecManager.getQueueLength(tabId);
    }

    /**
     * Cancel all pending executions for a tab
     */
    cancelQueue(tabId: string): void {
        this.tabExecManager.cancelQueue(tabId);
    }

    /**
     * Get statistics for debugging
     */
    getStats() {
        return this.tabExecManager.getStats();
    }
}
