import type { Dispatch, SetStateAction } from 'react';

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import { addLog } from '../../logger.ts';
import type * as Types from '../../types.ts';
import {
    runClaudeStream,
    type RunClaudeStreamCallbacks,
    type ToolResultEvent,
    type ToolUseEvent,
} from '../../agent/runtime/runClaudeStream.ts';
import { agentsConfig } from './agents-config.ts';

export interface StoryFlowHooks {
    nextMessageId: () => number;
    setActiveMessages: Dispatch<SetStateAction<Types.Message[]>>;
    setFrozenMessages: Dispatch<SetStateAction<Types.Message[]>>;
    finalizeMessageById: (messageId: number) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
    workspacePath?: string;
    session: {
        id: string;
        initialized: boolean;
        markInitialized: () => void;
    };
}

export interface StoryFlowState {
    task: string;
    structuredStories?: string;
    coverageAssessment?: string;
    groupedDocument?: string;
    transcript: Array<{
        stage: StoryNodeId;
        text: string;
        reasoning?: string;
    }>;
}

export interface StoryFlowResult extends StoryFlowState {}

export type StoryNodeId = 'structure' | 'review' | 'organize';

interface StoryNodeConfig {
    id: StoryNodeId;
    label: string;
    buildPrompt: (state: StoryFlowState) => string;
    agents: Record<string, unknown>;
    applyResult: (state: StoryFlowState, result: StoryNodeResult) => void;
}

interface StoryNodeResult {
    text: string;
    reasoning: string;
}

const formatXmlBlock = (title: string, xml: string | undefined): string =>
    xml && xml.trim().length > 0
        ? `${title}\n\`\`\`xml\n${xml.trim()}\n\`\`\`\n`
        : `${title}\n(none)\n`;

export async function runStoryFlow(task: string, hooks: StoryFlowHooks): Promise<StoryFlowResult> {
    const state: StoryFlowState = {
        task,
        transcript: [],
    };

    const sessionId = hooks.session.id;
    if (!sessionId) {
        throw new Error('StoryFlow requires a valid Claude session id');
    }
    let sessionInitialized = hooks.session.initialized;

    const pushSystemMessage = (content: string, boxed = false) => {
        const message: Types.Message = {
            id: hooks.nextMessageId(),
            role: 'system',
            content,
            isBoxed: boxed,
        };
        hooks.setFrozenMessages(prev => [...prev, message]);
    };

    const createStreamCallbacks = (stage: StoryNodeId, aggregates: StoryNodeResult): RunClaudeStreamCallbacks => {
        const emitAssistantText = (text: string) => {
            if (!text) return;
            aggregates.text += text;
            const messageId = hooks.nextMessageId();
            hooks.setActiveMessages(prev => [
                ...prev,
                {
                    id: messageId,
                    role: 'assistant',
                    content: text,
                    reasoning: '',
                },
            ]);
            hooks.finalizeMessageById(messageId);
        };

        const emitAssistantReasoning = (text: string) => {
            if (!text) return;
            aggregates.reasoning += text;
            const messageId = hooks.nextMessageId();
            hooks.setActiveMessages(prev => [
                ...prev,
                {
                    id: messageId,
                    role: 'assistant',
                    content: '',
                    reasoning: text,
                },
            ]);
            hooks.finalizeMessageById(messageId);
        };

        const emitToolUse = ({ id, name, description }: ToolUseEvent) => {
            const messageId = hooks.nextMessageId();
            const namePart = ` name=${name}`;
            const descriptionSuffix = description ? ` · ${description}` : '';
            hooks.setActiveMessages(prev => [
                ...prev,
                {
                    id: messageId,
                    role: 'system',
                    content: `[Story:${stage}] tool_use id=${id},${namePart}${descriptionSuffix}`,
                },
            ]);
            hooks.finalizeMessageById(messageId);
        };

        const emitToolResult = ({ id, name }: ToolResultEvent) => {
            const messageId = hooks.nextMessageId();
            hooks.setActiveMessages(prev => [
                ...prev,
                {
                    id: messageId,
                    role: 'system',
                    content: `[Story:${stage}] tool_result tool_use_id=${id}, name=${name}`,
                },
            ]);
            hooks.finalizeMessageById(messageId);
        };

        return {
            onTextDelta: emitAssistantText,
            onReasoningDelta: emitAssistantReasoning,
            onToolUse: emitToolUse,
            onToolResult: emitToolResult,
        };
    };

    const nodes: StoryNodeConfig[] = [
        {
            id: 'structure',
            label: 'Structuring stories',
            agents: {
                structurer: agentsConfig.structurer,
            },
            buildPrompt: currentState => {
                return [
                    '@structurer',
                    'You will restructure the stakeholder input into Stories with matching Acceptance Criteria.',
                    '',
                    '=== Stakeholder Input ===',
                    '```text',
                    currentState.task.trim(),
                    '```',
                    '',
                    'Remember: mirror the stakeholder wording exactly; do not invent anything new.',
                ].join('\n');
            },
            applyResult: (currentState, result) => {
                currentState.structuredStories = result.text.trim();
            },
        },
        {
            id: 'review',
            label: 'Reviewing coverage',
            agents: {
                reviewer: agentsConfig.reviewer,
            },
            buildPrompt: currentState => {
                return [
                    '@reviewer',
                    'Assess whether the structured stories cover the stakeholder input. Flag mandatory gaps only.',
                    '',
                    '=== Stakeholder Input ===',
                    '```text',
                    currentState.task.trim(),
                    '```',
                    '',
                    '=== Structured Stories ===',
                    '```xml',
                    (currentState.structuredStories ?? '').trim(),
                    '```',
                ].join('\n');
            },
            applyResult: (currentState, result) => {
                currentState.coverageAssessment = result.text.trim();
            },
        },
        {
            id: 'organize',
            label: 'Organising delivery groups',
            agents: {
                organizer: agentsConfig.organizer,
            },
            buildPrompt: currentState => {
                return [
                    '@organizer',
                    'Prepare the final Story document, grouping stories by dependency and priority.',
                    '',
                    'Use the structured stories and reviewer additions to build the final document.',
                    '',
                    formatXmlBlock('Structured Stories', currentState.structuredStories).trim(),
                    '',
                    formatXmlBlock('Coverage Findings', currentState.coverageAssessment).trim(),
                ].join('\n');
            },
            applyResult: (currentState, result) => {
                currentState.groupedDocument = result.text.trim();
            },
        },
    ];

    for (const node of nodes) {
        pushSystemMessage(`🚩 Story flow · ${node.label}...`);
        addLog(`[StoryFlow] Starting node=${node.id}`);

        const aggregates: StoryNodeResult = {
            text: '',
            reasoning: '',
        };

        try {
            await runClaudeStream({
                prompt: node.buildPrompt(state),
                session: {
                    id: sessionId,
                    initialized: sessionInitialized,
                },
                queryOptions: {
                    model: process.env.ANTHROPIC_MODEL,
                    cwd: hooks.workspacePath,
                    canUseTool: hooks.canUseTool,
                    agents: node.agents,
                },
                callbacks: createStreamCallbacks(node.id, aggregates),
            });
            sessionInitialized = true;
            node.applyResult(state, aggregates);
            state.transcript.push({
                stage: node.id,
                text: aggregates.text.trim(),
                reasoning: aggregates.reasoning.trim() || undefined,
            });

            pushSystemMessage(`✅ Story flow · ${node.label} completed`, node.id === 'organize');
            addLog(`[StoryFlow] Completed node=${node.id} text_len=${aggregates.text.length}`);
            if (!sessionInitialized) {
                hooks.session.markInitialized();
                sessionInitialized = true;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`[StoryFlow] Node ${node.id} failed: ${message}`);
            pushSystemMessage(`❌ Story flow · ${node.label} failed: ${message}`, true);
            throw error;
        }
    }

    return state;
}
