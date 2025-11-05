/**
 * Agent Registry
 * 
 * Central registry for all available agents in the application.
 * Provides unified interface for agent discovery and instantiation.
 */

import type { EventBus } from '@taskagent/core/event-bus';
import type { AgentStartContext, AgentStartSinks, ExecutionHandle } from '../runtime/types.js';
import { MessageAdapter } from '@taskagent/execution/MessageAdapter.js';

/**
 * Agent Factory - creates agent instances
 */
export type AgentFactory = () => Promise<Agent>;

/**
 * Agent interface - all agents must implement this
 */
export interface Agent {
    id: string;
    description: string;
    start(
        userInput: string,
        context: AgentStartContext,
        sinks: AgentStartSinks
    ): ExecutionHandle | Promise<ExecutionHandle>;
}

/**
 * Agent Registration Entry
 */
export interface AgentRegistryEntry {
    id: string;
    factory: AgentFactory;
    description: string;
    tags?: string[];  // e.g., ['planning', 'code-gen', 'review']
}

/**
 * Agent Registry - manages all available agents
 */
export class AgentRegistry {
    private agents = new Map<string, AgentRegistryEntry>();

    /**
     * Register an agent
     */
    register(entry: AgentRegistryEntry): void {
        if (this.agents.has(entry.id)) {
            console.warn(`[AgentRegistry] Agent ${entry.id} already registered, overwriting`);
        }
        this.agents.set(entry.id, entry);
    }

    /**
     * Get agent factory by ID
     */
    getFactory(agentId: string): AgentFactory | undefined {
        return this.agents.get(agentId)?.factory;
    }

    /**
     * Get all registered agent IDs
     */
    getAllIds(): string[] {
        return Array.from(this.agents.keys());
    }

    /**
     * Get all registered agents
     */
    getAllEntries(): AgentRegistryEntry[] {
        return Array.from(this.agents.values());
    }

    /**
     * Check if agent is registered
     */
    has(agentId: string): boolean {
        return this.agents.has(agentId);
    }

    /**
     * Create agent instance
     */
    async createAgent(agentId: string): Promise<Agent | null> {
        const factory = this.getFactory(agentId);
        if (!factory) {
            console.error(`[AgentRegistry] Agent ${agentId} not found`);
            return null;
        }

        try {
            return await factory();
        } catch (error) {
            console.error(`[AgentRegistry] Failed to create agent ${agentId}:`, error);
            return null;
        }
    }

    /**
     * Start an agent with EventBus integration
     * 
     * This is the main entry point for running agents.
     * It automatically wraps the agent's sinks with EventBus adapter.
     */
    async startAgent(
        agentId: string,
        userInput: string,
        context: AgentStartContext,
        eventBus: EventBus,
        canUseTool: AgentStartSinks['canUseTool']
    ): Promise<ExecutionHandle | null> {
        const agent = await this.createAgent(agentId);
        if (!agent) {
            return null;
        }

        // Create EventBus adapter for agent callbacks
        const adapter = new MessageAdapter(
            context.sourceTabId,
            agent.id,
            eventBus
        );
        const sinks = adapter.createSinks(canUseTool);

        try {
            return await agent.start(userInput, context, sinks);
        } catch (error) {
            console.error(`[AgentRegistry] Failed to start agent ${agentId}:`, error);
            
            // Emit failure event
            eventBus.emit({
                type: 'agent:failed',
                agentId: agent.id,
                tabId: context.sourceTabId,
                timestamp: Date.now(),
                payload: error instanceof Error ? error.message : String(error),
                version: '1.0',
            });
            
            return null;
        }
    }
}

/**
 * Global agent registry instance
 */
export const globalAgentRegistry = new AgentRegistry();

