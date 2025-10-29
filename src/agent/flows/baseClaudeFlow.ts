import type { Dispatch, SetStateAction } from 'react';

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type * as Types from '../../types.ts';
import { runClaudeStream, type ToolResultEvent, type ToolUseEvent } from '../runtime/runClaudeStream.ts';

export interface BaseClaudeFlowDependencies {
    nextMessageId: () => number;
    setActiveMessages: Dispatch<SetStateAction<Types.Message[]>>;
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
    const handleUserInput = async ({ prompt, agentSessionId, sessionInitialized, systemPrompt, allowedTools, disallowedTools, permissionMode }: BaseClaudeFlowRunArgs): Promise<boolean> => {
        const emitAssistantText = (text: string) => {
            if (!text) {
                return;
            }
            const textMessageId = nextMessageId();
            setActiveMessages(prev => [
                ...prev,
                {
                    id: textMessageId,
                    role: 'assistant',
                    content: text,
                    reasoning: '',
                },
            ]);
            finalizeMessageById(textMessageId);
        };

        const emitAssistantReasoning = (text: string) => {
            if (!text) {
                return;
            }
            const reasoningMessageId = nextMessageId();
            setActiveMessages(prev => [
                ...prev,
                {
                    id: reasoningMessageId,
                    role: 'assistant',
                    content: '',
                    reasoning: text,
                },
            ]);
            finalizeMessageById(reasoningMessageId);
        };

        const emitToolUse = ({ id, name, description }: ToolUseEvent) => {
            const base = `event: tool_use, id=${id}, name=${name}`;
            const line = description
                ? `${base}, description: ${description}`
                : base;
            const toolUseMessageId = nextMessageId();
            setActiveMessages(prev => [
                ...prev,
                { id: toolUseMessageId, role: 'system', content: line },
            ]);
            finalizeMessageById(toolUseMessageId);
        };

        const emitToolResult = ({ id, name }: ToolResultEvent) => {
            const toolResultMessageId = nextMessageId();
            setActiveMessages(prev => [
                ...prev,
                { id: toolResultMessageId, role: 'system', content: `event: tool_result, tool_use_id: ${id}, name=${name}` },
            ]);
            finalizeMessageById(toolResultMessageId);
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
