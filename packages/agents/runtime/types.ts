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
    /**
     * When resuming an initialized session, request the SDK to fork
     * into a new session instead of continuing the original.
     * Default: false. Set to true for background (/bg) runs.
     */
    forkSession?: boolean;
};

export type AgentStartSinks = {
    onText: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onEvent?: (e: TaskEvent) => void;
    onCompleted?: (fullText: string) => void;
    onFailed?: (error: string) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
    /**
     * Notifies the resolved SDK session id (first system event),
     * which may differ from the input context session id when forking.
     */
    onSessionId?: (sessionId: string) => void;
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

// Note: Legacy StackAgent removed. New pattern uses PromptAgent + systemPrompt (preset+append)
// and supplies sub-agents as SDK agent definitions directly when needed.

/**
 * DefaultAtomicAgent - Pass-through agent for direct SDK query
 * Used by Chat and Agent tabs to maintain existing behavior
 */
export class DefaultAtomicAgent implements RunnableAgent {
    readonly id = 'default';
    readonly description = 'Direct query without agent wrapper';

    getPrompt(userInput: string): string {
        return userInput; // Pass through without modification
    }

    getTools(): string[] {
        return [];
    }

    getModel(): string | undefined {
        return undefined;
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        // Use the shared builder for standard prompt agent behavior
        const { buildPromptAgentStart } = require('./runPromptAgentStart.js');
        const starter = buildPromptAgentStart({
            getPrompt: (input: string) => input,
            getSystemPrompt: () => ({ type: 'preset', preset: 'claude_code' } as const),
        });
        return starter(userInput, context, sinks);
    }
}
