import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverRuntimeContext } from '../types.js';
import type { Message } from '../../types.js';
import { createStoryPromptAgent } from './agent.js';

// Best-practice runtime: run Story as a PromptAgent instance in Foreground by default
async function handleStoryInvocation(message: Message, context: DriverRuntimeContext): Promise<boolean> {
    const prompt = message.content.trim();
    if (!prompt) return false;

    // Instantiate PromptAgent from .agent.md files
    const agent = await createStoryPromptAgent();

    if (!context.startForeground) {
        throw new Error('startForeground is not available in runtime context');
    }

    // First, show the user's message (gray background) and finalize it into history
    const userId = context.nextMessageId();
    context.setActiveMessages(prev => [...prev, { id: userId, role: 'user', content: prompt }]);
    context.finalizeMessageById(userId);

    // Create an assistant message container for streaming (keep current queued behavior unchanged)
    const pendingId = context.nextMessageId();
    context.setActiveMessages(prev => [...prev, { id: pendingId, role: 'assistant', content: '', isPending: true }]);
    let hasFinalizedPending = false;

    const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' } as const;

    context.startForeground(
        agent,
        prompt,
        { sourceTabId: context.sourceTabId || 'Story', workspacePath: context.workspacePath, session: context.session },
        {
            onText: (chunk: string) => {
                if (!chunk) {
                    return;
                }

                if (!hasFinalizedPending) {
                    context.finalizeMessageById(pendingId);
                    hasFinalizedPending = true;
                }

                const textMsgId = context.nextMessageId();
                context.setFrozenMessages(prev => [...prev, { id: textMsgId, role: 'assistant', content: chunk }]);
            },
            onEvent: (event) => {
                const icon = levelIcons[event.level] || '📝';
                context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `${icon} [Story] ${event.message}`, isBoxed: event.level === 'error' }]);
            },
            onCompleted: () => {
                if (!hasFinalizedPending) {
                    context.finalizeMessageById(pendingId);
                    hasFinalizedPending = true;
                }
                context.session?.markInitialized();
            },
            onFailed: (error: string) => {
                // Finalize any partial output and show error
                if (!hasFinalizedPending) {
                    context.finalizeMessageById(pendingId);
                    hasFinalizedPending = true;
                }
                context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `❌ [Story] 失败：${error}`, isBoxed: true }]);
            },
            canUseTool: context.canUseTool,
        }
    );

    return true;
}

export const storyDriverEntry: ViewDriverEntry = {
    type: 'view',
    id: Driver.STORY,
    label: Driver.STORY,
    description: 'Story Orchestration · 整理、审阅并沉淀到 Markdown',
    requiresSession: true,
    component: StackAgentView,
    // Best-practice: run via PromptAgent instance, no pipeline overrides
    handler: handleStoryInvocation,
};

// Re-export factory for external consumers/tests
export { createStoryPromptAgent } from './agent.js';
