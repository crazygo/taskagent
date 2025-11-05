import type { AgentDefinition, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import { EventBus } from '@taskagent/core/event-bus';
import type { AgentEvent, AgentTextPayload, AgentReasoningPayload, AgentEventPayload } from '@taskagent/core/types/AgentEvent.js';
import type { Message } from '@taskagent/core/types/Message.js';

import { runClaudeStream, type ToolResultEvent, type ToolUseEvent } from '../runClaudeStream.js';

// Minimal React-less state setter type
type SetState<T> = (value: T | ((prev: T) => T)) => void;

export interface BaseClaudeFlowDependencies {
    nextMessageId: () => number;
    setActiveMessages: SetState<any>;
    finalizeMessageById: (messageId: number) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
    workspacePath?: string;
}

export interface BaseClaudeFlowRunArgs {
    prompt: string;
    agentSessionId: string;
    sessionInitialized: boolean;
    systemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
    agents?: Record<string, AgentDefinition>;
}

export interface BaseClaudeFlow {
    id: string;
    label: string;
    handleUserInput: (args: BaseClaudeFlowRunArgs) => Promise<boolean>;
}

export const createBaseClaudeFlow = ({
    nextMessageId,
    setActiveMessages,
    finalizeMessageById,
    canUseTool,
    workspacePath,
}: BaseClaudeFlowDependencies): BaseClaudeFlow => {
    // NEW: Internal EventBus to decouple logic while maintaining the external signature.
    const localEventBus = new EventBus();

    // NEW: Bridge from internal events to the external (legacy) UI state setters.
    // This is the key to satisfying the "don't change externals" constraint.
    localEventBus.on('agent:text', (event) => {
        const payload = event.payload as AgentTextPayload;
        if (!payload.chunk) return;

        const textMessageId = nextMessageId();
        setActiveMessages(((prev: any[]) => [
            ...prev,
            {
                id: textMessageId,
                role: 'assistant',
                content: payload.chunk,
                reasoning: '',
            },
        ]) as any);
        finalizeMessageById(textMessageId);
    });

    localEventBus.on('agent:reasoning', (event) => {
        const payload = event.payload as AgentReasoningPayload;
        if (!payload.reasoning) return;

        const reasoningMessageId = nextMessageId();
        setActiveMessages(((prev: any[]) => [
            ...prev,
            {
                id: reasoningMessageId,
                role: 'assistant',
                content: '',
                reasoning: payload.reasoning,
            },
        ]) as any);
        finalizeMessageById(reasoningMessageId);
    });

    localEventBus.on('agent:event', (event) => {
        const payload = event.payload as AgentEventPayload;
        if (!payload.message) return;

        const toolMessageId = nextMessageId();
        setActiveMessages(((prev: any[]) => [
            ...prev,
            { id: toolMessageId, role: 'system', content: payload.message },
        ]) as any);
        finalizeMessageById(toolMessageId);
    });


    const handleUserInput = async ({ prompt, agentSessionId, sessionInitialized, systemPrompt, allowedTools, disallowedTools, permissionMode, agents }: BaseClaudeFlowRunArgs): Promise<boolean> => {
        
        const emitEvent = (type: AgentEvent['type'], payload: unknown) => {
            localEventBus.emit({
                type,
                agentId: 'base-claude-flow', // Hardcoded for this context
                tabId: 'unknown', // This flow doesn't have tab context, a limitation of this legacy component
                timestamp: Date.now(),
                payload,
                version: '1.0',
            });
        };

        // REFACTORED: Callbacks now emit events instead of directly setting state.
        const emitAssistantText = (text: string) => {
            emitEvent('agent:text', { chunk: text } as AgentTextPayload);
        };

        const emitAssistantReasoning = (text: string) => {
            emitEvent('agent:reasoning', { reasoning: text } as AgentReasoningPayload);
        };

        const emitToolUse = ({ id, name, description }: ToolUseEvent) => {
            const base = `event: tool_use, id=${id}, name=${name}`;
            const line = description ? `${base}, description: ${description}` : base;
            emitEvent('agent:event', { level: 'info', message: line } as AgentEventPayload);
        };

        const emitToolResult = ({ id, name }: ToolResultEvent) => {
            const line = `event: tool_result, tool_use_id: ${id}, name=${name}`;
            emitEvent('agent:event', { level: 'info', message: line } as AgentEventPayload);
        };

        await runClaudeStream({
            prompt,
            session: {
                id: agentSessionId,
                initialized: sessionInitialized,
            },
            queryOptions: {
                model: process.env.ANTHROPIC_MODEL,
                cwd: workspacePath,
                canUseTool,
                systemPrompt,
                allowedTools,
                disallowedTools,
                permissionMode,
                agents,
            },
            callbacks: {
                onTextDelta: emitAssistantText,
                onReasoningDelta: emitAssistantReasoning,
                onToolUse: emitToolUse,
                onToolResult: emitToolResult,
            },
        });

        return true;
    };

    return {
        id: 'base-claude',
        label: 'Claude',
        handleUserInput,
    };
};