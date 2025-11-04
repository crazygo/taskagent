import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverRuntimeContext } from '../types.js';
import type { Message } from '../../types.js';
import { createGlossaryPromptAgent } from './agent.js';

// Best-practice runtime: run Glossary as a PromptAgent instance in Foreground by default
async function handleGlossaryInvocation(message: Message, context: DriverRuntimeContext): Promise<boolean> {
    const prompt = message.content.trim();
    if (!prompt) return false;

    const agent = await createGlossaryPromptAgent();

    if (!context.startForeground) {
        throw new Error('startForeground is not available in runtime context');
    }

    const pendingId = context.nextMessageId();
    context.setActiveMessages(prev => [...prev, { id: pendingId, role: 'assistant', content: '', isPending: true }]);

    const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' } as const;

    context.startForeground(
        agent,
        prompt,
        { sourceTabId: context.sourceTabId || 'Glossary', workspacePath: context.workspacePath, session: context.session },
        {
            onText: (chunk: string) => {
                context.setActiveMessages(prev => prev.map(m => m.id === pendingId ? { ...m, content: (m.content || '') + chunk } : m));
            },
            onEvent: (event) => {
                const icon = levelIcons[event.level] || '📝';
                context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `${icon} [Glossary] ${event.message}`, isBoxed: event.level === 'error' }]);
            },
            onCompleted: () => {
                context.finalizeMessageById(pendingId);
            },
            onFailed: (error: string) => {
                context.finalizeMessageById(pendingId);
                context.setFrozenMessages(prev => [...prev, { id: context.nextMessageId(), role: 'system', content: `❌ [Glossary] 失败：${error}`, isBoxed: true }]);
            },
            canUseTool: context.canUseTool,
        }
    );

    return true;
}

export const glossaryDriverEntry: ViewDriverEntry = {
    type: 'view',
    id: Driver.GLOSSARY,
    label: Driver.GLOSSARY,
    description: 'Manage and understand project terminology',
    requiresSession: true,
    component: StackAgentView,
    // Best-practice: run via PromptAgent instance, no pipeline overrides
    handler: handleGlossaryInvocation,
};

// Re-export a factory that returns a PromptAgent-like instance for Glossary.
// Supports the migration where Glossary is not a class, just a PromptAgent instance.
export { createGlossaryPromptAgent } from './agent.js';
