import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { tool as createSdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { Message } from '@taskagent/core/types/Message.js';
import type { TaskEvent } from '@taskagent/core/types/TaskEvent.js';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { ToolUseEvent, ToolResultEvent } from './runClaudeStream.js';
import { addLog } from '@taskagent/shared/logger';
import { z } from 'zod';
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
    /**
     * Parent agent in call chain (for agent hierarchy tracking)
     */
    parentAgentId?: string;
};

export type AgentStartSinks = {
    onText: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onEvent?: (e: TaskEvent | ToolUseEvent | ToolResultEvent) => void;
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
    /**
     * Promise that resolves when the agent finishes streaming.
     * Resolves to true on successful completion, false when the stream fails or is aborted.
     */
    completion: Promise<boolean>;
}

/**
 * Execution context for agent tools
 */
export interface AgentToolContext {
    sourceTabId?: string;
    workspacePath?: string;
    parentAgentId?: string;
    tabExecutor?: any;
    agentRegistry?: any;
    eventBus?: any;
}

/**
 * BaseAgent - common base for all agents
 */
export abstract class BaseAgent {
    abstract readonly id: string;
    abstract readonly description: string;

    /**
     * Runtime context overrides (sourceTabId, workspacePath, parentAgentId)
     * Merged with agent's own dependencies when creating MCP tool
     */
    protected runtimeContext: Partial<AgentToolContext> = {};

    /**
     * Set runtime context before calling asMcpTool
     */
    setRuntimeContext(ctx: Partial<AgentToolContext>): void {
        this.runtimeContext = ctx;
    }

    /**
     * Convert this agent into an MCP tool callable by other agents (standard version)
     * Uses single 'prompt' parameter by default
     */
    asMcpTool(ctx?: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string }): ReturnType<typeof createSdkTool> | undefined {
        return this.asMcpToolWithSchema(
            { prompt: z.string().min(1).describe('自然语言输入') },
            (args: { prompt: string }) => args.prompt,
            ctx
        );
    }

    /**
     * Convert this agent into an MCP tool with custom schema
     */
    asMcpToolWithSchema<T extends Record<string, any>>(
        schema: Record<string, any>,
        concater: (args: T) => string,
        ctx?: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string },
        options?: { async?: boolean }
    ): ReturnType<typeof createSdkTool> | undefined {
        // Set runtime context if provided
        if (ctx) this.setRuntimeContext(ctx);
        
        // Merge instance deps with runtime context
        const fullContext = this.buildToolContext();
        if (!fullContext.eventBus || !fullContext.tabExecutor || !fullContext.agentRegistry) {
            return undefined;
        }

        return createSdkTool(
            this.id,
            this.description,
            schema,
            async (args: Record<string, any>) => {
                addLog(`[${this.id}] MCP tool handler called with args: ${JSON.stringify(args).slice(0, 200)}`);
                const prompt = concater(args as T);
                addLog(`[${this.id}] Converted to prompt: ${prompt.slice(0, 100)}...`);
                const result = await fullContext.tabExecutor.execute(
                    this.id,
                    this.id,
                    prompt,
                    {
                        sourceTabId: fullContext.sourceTabId,
                        workspacePath: fullContext.workspacePath,
                        parentAgentId: fullContext.parentAgentId,
                    },
                    { async: options?.async }
                );
                addLog(`[${this.id}] MCP tool handler completed`);
                return {
                    content: [{ type: 'text' as const, text: result.output || result.result || (options?.async ? '任务已异步运行，请稍后查看结果' : '完成') }]
                };
            }
        ) as any;
    }

    /**
     * Build full tool context from instance dependencies + runtime context
     * Override in subclass if dependencies are stored differently
     */
    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
        };
    }
}

/**
 * PromptAgent - Base class for single-purpose, prompt-driven agents
 * Can contain self-managed loop logic within the prompt
 * Can be exposed as MCP tools to other agents
 */
export abstract class PromptAgent extends BaseAgent {
    abstract readonly id: string;
    abstract readonly description: string;

    /**
     * Generate the prompt for SDK query
     */
    abstract getPrompt(userInput: string, context: AgentContext): string;

    /** Optional tools */
    getTools?(): string[];
    /** Optional model override */
    getModel?(): string;
    /** Optional output parser */
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
    asMcpTool?: (ctx: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string }) => ReturnType<
        typeof createSdkTool
    > | undefined;
    asMcpToolWithSchema?: <T extends Record<string, any>>(
        schema: Record<string, any>,
        concater: (args: T) => string,
        ctx?: { sourceTabId?: string; workspacePath?: string; parentAgentId?: string },
        options?: { async?: boolean }
    ) => ReturnType<typeof createSdkTool> | undefined;
    start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;
}

// Note: Legacy StackAgent removed. New pattern uses PromptAgent + systemPrompt (preset+append)
// and supplies sub-agents as SDK agent definitions directly when needed.

/**
 * DefaultPromptAgent - Pass-through PromptAgent wrapped as RunnableAgent
 * Used by Chat and Agent tabs to maintain existing behavior
 */
import { buildPromptAgentStart } from './runPromptAgentStart.js';

export class DefaultPromptAgent implements RunnableAgent {
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
        const starter = buildPromptAgentStart({
            getPrompt: (input: string) => input,
            getSystemPrompt: () => ({ type: 'preset', preset: 'claude_code' } as const),
        });
        return starter(userInput, context, sinks);
    }
}
