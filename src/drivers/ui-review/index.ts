import type { Dispatch, SetStateAction } from 'react';

import type { Message } from '../../types.ts';
import { addLog } from '../../logger.ts';
import { runClaudeStream } from '../../agent/runtime/runClaudeStream.ts';
import { buildUiReviewSystemPrompt, UI_REVIEW_PROMPT_VERSION } from './prompt.ts';

export interface UiReviewCallbacks {
    nextMessageId: () => number;
    setActiveMessages: Dispatch<SetStateAction<Message[]>>;
    setFrozenMessages: Dispatch<SetStateAction<Message[]>>;
    finalizeMessageById: (messageId: number) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
    workspacePath?: string;
    session: {
        id: string;
        initialized: boolean;
        markInitialized: () => void;
    };
}

export async function handleUiReview(
    userMessage: Message,
    callbacks: UiReviewCallbacks
): Promise<boolean> {
    addLog(`[UiReview] Received message: ${userMessage.content}`);

    // Echo user message (align with Agent tab behavior)
    callbacks.setActiveMessages(prev => [...prev, userMessage]);
    callbacks.finalizeMessageById(userMessage.id);

    // Announce mode
    const bannerId = callbacks.nextMessageId();
    callbacks.setFrozenMessages(prev => [
        ...prev,
        {
            id: bannerId,
            role: 'system',
            content: `🧩 UI Review · ${UI_REVIEW_PROMPT_VERSION} · tools=read-only (Read/Grep/Glob)`,
            isBoxed: true,
        },
    ]);

    const emitAssistantText = (text: string) => {
        if (!text) return;
        const id = callbacks.nextMessageId();
        callbacks.setActiveMessages(prev => [
            ...prev,
            { id, role: 'assistant', content: text, reasoning: '' },
        ]);
        callbacks.finalizeMessageById(id);
    };

    const emitAssistantReasoning = (text: string) => {
        if (!text) return;
        const id = callbacks.nextMessageId();
        callbacks.setActiveMessages(prev => [
            ...prev,
            { id, role: 'assistant', content: '', reasoning: text },
        ]);
        callbacks.finalizeMessageById(id);
    };

    try {
        await runClaudeStream({
            prompt: userMessage.content,
            session: {
                id: callbacks.session.id,
                initialized: callbacks.session.initialized,
            },
            queryOptions: {
                model: process.env.ANTHROPIC_MODEL,
                cwd: callbacks.workspacePath,
                canUseTool: callbacks.canUseTool as any,
                systemPrompt: buildUiReviewSystemPrompt(),
            },
            callbacks: {
                onTextDelta: emitAssistantText,
                onReasoningDelta: emitAssistantReasoning,
            },
        });
        callbacks.session.markInitialized();
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog(`[UiReview] Error: ${message}`);
        const id = callbacks.nextMessageId();
        callbacks.setFrozenMessages(prev => [
            ...prev,
            { id, role: 'system', content: `❌ UI Review failed: ${message}`, isBoxed: true },
        ]);
        return false;
    }
}


