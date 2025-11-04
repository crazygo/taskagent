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

    // Create a pending assistant message for streaming
    const pendingId = context.nextMessageId();
    context.setActiveMessages(prev => [...prev, { id: pendingId, role: 'assistant', content: '', isPending: true }]);

    const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' } as const;

    context.startForeground(
        agent,
        prompt,
        { sourceTabId: context.sourceTabId || 'Story', workspacePath: context.workspacePath, session: context.session },
        {
            onText: (chunk: string) => {
                context.setActiveMessages(prev => prev.map(m => m.id === pendingId ? { ...m, content: (m.content || '') + chunk } : m));
            },
            onEvent: (event) => {
                const icon = levelIcons[event.level] || '📝';
                context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `${icon} [Story] ${event.message}`, isBoxed: event.level === 'error' }]);
            },
            onCompleted: () => {
                context.finalizeMessageById(pendingId);
            },
            onFailed: (error: string) => {
                // Finalize any partial output and show error
                context.finalizeMessageById(pendingId);
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
