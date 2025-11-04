import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { Message, TaskEvent } from '../types.js';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

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
 * Unified start() contract – minimal, non-blocking execution handle
 */
export type AgentStartContext = {
    sourceTabId: string;
    workspacePath?: string;
    session?: { id: string; initialized: boolean };
};

export type AgentStartSinks = {
    onText: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onEvent?: (e: TaskEvent) => void;
    onCompleted?: (fullText: string) => void;
    onFailed?: (error: string) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
};

export interface ExecutionHandle {
    cancel: () => void;
    sessionId: string;
}

/**
 * PromptAgent - Base class for single-purpose, prompt-driven agents
 * Can contain self-managed loop logic within the prompt
 */
export abstract class PromptAgent {
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
 * RunnableAgent – unified external contract for agents
 * Backed by either a prompt-driven or programmatic implementation.
 */
export interface RunnableAgent {
    id: string;
    description: string;
    getPrompt?: (userInput: string, context: AgentContext | AgentStartContext) => string;
    getTools?: () => string[];
    getModel?: () => string | undefined;
    parseOutput?: (rawChunk: string) => TaskEvent[];
    getAgentDefinitions?: () => Record<string, AgentDefinition> | undefined;
    start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;
}

/**
 * StackAgent - Orchestrates multiple AtomicAgents
 * Inherits from AtomicAgent but adds coordinator capabilities
 */
export abstract class StackAgent extends PromptAgent {
    abstract readonly subAgents: Record<string, PromptAgent>;
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
export class DefaultAtomicAgent extends PromptAgent {
    readonly id = 'default';
    readonly description = 'Direct query without agent wrapper';

    getPrompt(userInput: string): string {
        return userInput; // Pass through without modification
    }
}
