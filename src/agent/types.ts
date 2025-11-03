import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { Message, TaskEvent } from '../types.js';

/**
 * Agent execution context
 */
export interface AgentContext {
    sourceTabId: string;
    messageIdFrom?: string;
    workspacePath?: string;
    frozenMessages?: Message[];
}

/**
 * AtomicAgent - Base class for single-purpose agents
 * Can contain self-managed loop logic within the prompt
 */
export abstract class AtomicAgent {
    abstract readonly id: string;
    abstract readonly description: string;

    /**
     * Generate the prompt for SDK query
     * @param userInput - Raw user input
     * @param context - Execution context
     * @returns Prompt string to send to LLM
     */
    abstract getPrompt(userInput: string, context: AgentContext): string;

    /**
     * Optional: Tools required by this agent
     */
    getTools?(): string[];

    /**
     * Optional: Model override
     */
    getModel?(): string;

    /**
     * Optional: Parse raw output into structured events
     * @param rawOutput - Accumulated output from agent execution
     * @returns Array of parsed events
     */
    parseOutput?(rawOutput: string): TaskEvent[];
}

/**
 * StackAgent - Orchestrates multiple AtomicAgents
 * Inherits from AtomicAgent but adds coordinator capabilities
 */
export abstract class StackAgent extends AtomicAgent {
    abstract readonly subAgents: Record<string, AtomicAgent>;
    abstract readonly coordinatorPrompt: string;

    /**
     * Override: Return coordinator prompt with user input
     */
    getPrompt(userInput: string, context: AgentContext): string {
        return this.coordinatorPrompt.replace(/\{\{USER_INPUT\}\}/g, userInput);
    }

    /**
     * Get SDK agent definitions for sub-agents
     */
    getAgentDefinitions(): Record<string, AgentDefinition> {
        const defs: Record<string, AgentDefinition> = {};
        for (const [name, agent] of Object.entries(this.subAgents)) {
            defs[name] = {
                description: agent.description,
                prompt: agent.getPrompt('', { sourceTabId: '' }),
                tools: agent.getTools?.(),
                model: agent.getModel?.() as any,
            };
        }
        return defs;
    }
}

/**
 * DefaultAtomicAgent - Pass-through agent for direct SDK query
 * Used by Chat and Agent tabs to maintain existing behavior
 */
export class DefaultAtomicAgent extends AtomicAgent {
    readonly id = 'default';
    readonly description = 'Direct query without agent wrapper';

    getPrompt(userInput: string): string {
        return userInput; // Pass through without modification
    }
}
