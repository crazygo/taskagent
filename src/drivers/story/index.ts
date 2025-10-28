/**
 * Story driver entry point.
 * Handles structured Story generation workflow orchestrated by runStoryFlow.
 */

import type { Dispatch, SetStateAction } from 'react';

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { Message } from '../../types.ts';
import { addLog } from '../../logger.ts';
import { runStoryFlow, type StoryFlowResult } from './flow.ts';

export interface StoryDriverCallbacks {
    nextMessageId: () => number;
    setActiveMessages: Dispatch<SetStateAction<Message[]>>;
    setFrozenMessages: Dispatch<SetStateAction<Message[]>>;
    finalizeMessageById: (messageId: number) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
    workspacePath?: string;
    session: {
        id: string;
        initialized: boolean;
        markInitialized: () => void;
    };
}

export async function handleStoryDriver(
    userMessage: Message,
    callbacks: StoryDriverCallbacks
): Promise<boolean> {
    addLog(`[StoryDriver] Received message: ${userMessage.content}`);

    callbacks.setActiveMessages(prev => [...prev, userMessage]);
    callbacks.finalizeMessageById(userMessage.id);

    try {
        const result: StoryFlowResult = await runStoryFlow(userMessage.content, {
            nextMessageId: callbacks.nextMessageId,
            setActiveMessages: callbacks.setActiveMessages,
            setFrozenMessages: callbacks.setFrozenMessages,
            finalizeMessageById: callbacks.finalizeMessageById,
            canUseTool: callbacks.canUseTool,
            workspacePath: callbacks.workspacePath,
            session: callbacks.session,
        });

        addLog(
            `[StoryDriver] Completed. structured=${Boolean(result.structuredStories)} gaps=${Boolean(result.coverageAssessment)} doc=${Boolean(result.groupedDocument)}`
        );

        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[StoryDriver] Error: ${message}`);
        return false;
    }
}
