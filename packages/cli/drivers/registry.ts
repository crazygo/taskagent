import type { Dispatch, SetStateAction } from 'react';
import type { AgentDefinition, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { Message } from '../types.js';
import type { Task } from '../../task-manager.js';
import { 
    Driver, 
    type DriverManifestEntry, 
    type ViewDriverEntry, 
    type BackgroundTaskDriverEntry, 
    type DriverRuntimeContext, 
    type DriverHandler, 
    type DriverPrepareFn 
} from './types.js';
import { handlePlanReviewDo } from './plan-review-do/index.js';
import { buildPromptAgentStart, createStoryPromptAgent, createGlossaryPromptAgent, createLogMonitor } from '@taskagent/agents';
import { uiReviewDriverEntry } from './ui-review/index.js';

// import { buildUiReviewSystemPrompt } from './ui-review/prompt.js'; // No longer needed here
import { storyDriverEntry } from './story/index.js';
import { glossaryDriverEntry } from './glossary/index.js';
import { monitorDriverEntry } from './monitor/index.js';
import { addLog } from '../logger.js';

import StackAgentView from '../components/StackAgentView.js';

// Import placeholder views
// import StoryView from '../views/StoryView.js'; // Will be replaced by StackAgentView
// import UiReviewView from '../views/UiReviewView.js'; // Will be replaced by StackAgentView
// import GlossaryView from '../views/GlossaryView.js'; // Will be replaced by StackAgentView
// import LogicReviewView from '../views/LogicReviewView.js'; // Will be replaced by StackAgentView
// import DataReviewView from '../views/DataReviewView.js'; // Will be replaced by StackAgentView

const createPlaceholderHandler = (label: string): DriverHandler => {
    return async (_message, context) => {
        const systemMessage: Message = {
            id: context.nextMessageId(),
            role: 'system',
            content: `⚠️ ${label} driver 尚未实现，敬请期待。`,
            isBoxed: true,
        };
        context.setFrozenMessages(prev => [...prev, systemMessage]);
        return true;
    };
};

export function getDriverManifest(): readonly DriverManifestEntry[] {
    // Auto-generate fg/bg slash commands for PromptAgent-based drivers
    const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' } as const;

    type AgentSlashSpec = {
        driverId: Driver;
        name: string; // e.g., 'story', 'glossary', 'log-monitor'
        requiresSession: boolean;
        defaultBgTimeout: number;
        createAgent: () => any | Promise<any>;
    };

    const agentSlashSpecs: AgentSlashSpec[] = [
        {
            driverId: Driver.STORY,
            name: 'story',
            requiresSession: true,
            defaultBgTimeout: 600,
            createAgent: async () => await createStoryPromptAgent(),
        },
        {
            driverId: Driver.GLOSSARY,
            name: 'glossary',
            requiresSession: true,
            defaultBgTimeout: 600,
            createAgent: async () => await createGlossaryPromptAgent(),
        },
        {
            driverId: Driver.LOG_MONITOR,
            name: 'log-monitor',
            requiresSession: true,
            defaultBgTimeout: 3600,
            createAgent: () => createLogMonitor('debug.log', 100, 30),
        },
    ];

    const fgEntries: BackgroundTaskDriverEntry[] = agentSlashSpecs.map((spec) => ({
        type: 'background_task',
        id: spec.driverId,
        label: `fg:${spec.name}`,
        slash: `fg:${spec.name}`,
        description: `前台运行 ${spec.driverId}`,
        requiresSession: spec.requiresSession,
        handler: async (message: Message, context: DriverRuntimeContext) => {
            const prompt = message.content.trim();
            if (!prompt) return false;
            if (!context.startForeground) {
                const systemMsg: Message = { id: context.nextMessageId(), role: 'system', content: `❌ [${spec.driverId}] 前台模式不可用（缺少 startForeground）`, isBoxed: true };
                context.setFrozenMessages(prev => [...prev, systemMsg]);
                return true;
            }
            const agent = await spec.createAgent();
            // Show user input then stream assistant
            const userId = context.nextMessageId();
            context.setActiveMessages(prev => [...prev, { id: userId, role: 'user', content: prompt }]);
            context.finalizeMessageById(userId);
            const pendingId = context.nextMessageId();
            context.setActiveMessages(prev => [...prev, { id: pendingId, role: 'assistant', content: '', isPending: true }]);
            let hasFinalizedPending = false;
            context.startForeground(
                agent,
                prompt,
                { sourceTabId: context.sourceTabId || String(spec.driverId), workspacePath: context.workspacePath, session: context.session },
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
                        const sysMsg: Message = { id: textMsgId, role: 'assistant', content: chunk };
                        context.setFrozenMessages(prev => [...prev, sysMsg]);
                    },
                    onEvent: (event) => {
                        const icon = levelIcons[event.level] || '📝';
                        const sysMsg: Message = { id: context.nextMessageId(), role: 'system', content: `${icon} [${spec.driverId}] ${event.message}`, isBoxed: event.level === 'error' };
                        context.setFrozenMessages(prev => [...prev, sysMsg]);
                    },
                    onCompleted: () => {
                        if (!hasFinalizedPending) {
                            context.finalizeMessageById(pendingId);
                            hasFinalizedPending = true;
                        }
                    },
                    onFailed: (error: string) => {
                        if (!hasFinalizedPending) {
                            context.finalizeMessageById(pendingId);
                            hasFinalizedPending = true;
                        }
                        const sysMsg: Message = { id: context.nextMessageId(), role: 'system', content: `❌ [${spec.driverId}] 前台运行失败：${error}`, isBoxed: true };
                        context.setFrozenMessages(prev => [...prev, sysMsg]);
                    },
                    canUseTool: context.canUseTool,
                }
            );
            return true;
        },
    }));

    const bgEntries: BackgroundTaskDriverEntry[] = agentSlashSpecs.map((spec) => ({
        type: 'background_task',
        id: spec.driverId,
        label: `bg:${spec.name}`,
        slash: `bg:${spec.name}`,
        description: `后台运行 ${spec.driverId}`,
        requiresSession: spec.requiresSession,
        handler: async (message: Message, context: DriverRuntimeContext) => {
            const prompt = message.content.trim();
            if (!prompt) return false;
            const agent = await spec.createAgent();
            if (!('startBackground' in context) || typeof (context as any).startBackground !== 'function') {
                const systemMsg: Message = { id: context.nextMessageId(), role: 'system', content: `❌ [${spec.driverId}] 当前环境不支持后台任务接口 startBackground`, isBoxed: true };
                context.setFrozenMessages(prev => [...prev, systemMsg]);
                return true;
            }
            try {
                const result = (context as any).startBackground(
                    agent,
                    prompt,
                    { sourceTabId: (context as any).sourceTabId || String(spec.driverId), workspacePath: context.workspacePath, timeoutSec: spec.defaultBgTimeout, session: (context as any).session, forkSession: true }
                );
                const { emitter } = result;
                // Acknowledge task creation
                const ackMsg: Message = { id: context.nextMessageId(), role: 'system', content: `🧵 [${spec.driverId}] 后台任务已创建：${result.task.id}` };
                context.setFrozenMessages(prev => [...prev, ackMsg]);
                // Subscribe to task events
                emitter.on('event', (event: any) => {
                    try { addLog(`[${spec.name}] Event: ${JSON.stringify(event)}`); } catch {}
                    const icon = levelIcons[event.level as keyof typeof levelIcons] || '📝';
                    const systemMsg: Message = { id: context.nextMessageId(), role: 'system', content: `${icon} [${spec.driverId}] ${event.message}`, isBoxed: event.level === 'error' };
                    context.setFrozenMessages(prev => [...prev, systemMsg]);
                });
                emitter.on('completed', () => {
                    const systemMsg: Message = { id: context.nextMessageId(), role: 'system', content: `✅ [${spec.driverId}] 任务已完成` };
                    context.setFrozenMessages(prev => [...prev, systemMsg]);
                });
                emitter.on('failed', (error: string) => {
                    const systemMsg: Message = { id: context.nextMessageId(), role: 'system', content: `❌ [${spec.driverId}] 任务失败：${error}`, isBoxed: true };
                    context.setFrozenMessages(prev => [...prev, systemMsg]);
                });
            } catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                const systemMsg: Message = { id: context.nextMessageId(), role: 'system', content: `❌ [${spec.driverId}] 后台任务创建失败：${messageText}`, isBoxed: true };
                context.setFrozenMessages(prev => [...prev, systemMsg]);
            }
            return true;
        },
    }));

    return [
        // Auto-generated slash entries
        ...fgEntries,
        ...bgEntries,
        // Explicit background workflow (not a simple PromptAgent)
        {
            type: 'background_task',
            id: Driver.PLAN_REVIEW_DO,
            label: Driver.PLAN_REVIEW_DO,
            slash: 'plan-review-do',
            description: '执行 Plan-Review-Do 工作流',
            requiresSession: false,
            handler: async (message: Message, context: DriverRuntimeContext) => {
                return await handlePlanReviewDo(message, {
                    nextMessageId: context.nextMessageId,
                    setActiveMessages: context.setActiveMessages,
                    setFrozenMessages: context.setFrozenMessages,
                    startTask: (prompt: string, options?: { agents?: Record<string, any> }) => {
                        const adapter = {
                            getPrompt: (userInput: string) => userInput,
                            getAgentDefinitions: () => options?.agents as any,
                        };
                        const agent = {
                            id: 'plan-review-do',
                            description: 'Ephemeral agent for Plan-Review-Do workflow',
                            start: buildPromptAgentStart(adapter),
                        } as any;
                        const result = context.startBackground(agent, prompt, { sourceTabId: context.sourceTabId || 'Plan-Review-DO', workspacePath: context.workspacePath, timeoutSec: 900, session: context.session, forkSession: true });
                        return { id: result.task.id };
                    },
                    waitTask: context.waitTask,
                });
            },
        },
        // View Drivers
        storyDriverEntry,
        uiReviewDriverEntry,
        glossaryDriverEntry,
        monitorDriverEntry,
    ];
}

const DRIVER_MANIFEST = getDriverManifest();

// Correctly generate tabs only from View drivers
export const DRIVER_TABS: readonly Driver[] = DRIVER_MANIFEST.filter((entry): entry is ViewDriverEntry => entry.type === 'view').map(entry => entry.label as Driver);

// Correctly generate commands only from Background Task drivers
export const getDriverCommandEntries = (): { name: string; description: string }[] => {
    return DRIVER_MANIFEST.filter((entry): entry is BackgroundTaskDriverEntry => entry.type === 'background_task').map(entry => ({
        name: entry.slash,
        description: entry.description,
    }));
};

// Helper to get a view driver by its label
export const getDriverByLabel = (label: string): ViewDriverEntry | undefined => {
    return DRIVER_MANIFEST.find((entry): entry is ViewDriverEntry => entry.type === 'view' && entry.label === label);
};

// Helper to get a background task driver by its slash command
export const getDriverBySlash = (slashName: string): BackgroundTaskDriverEntry | undefined => {
    const normalized = slashName.toLowerCase();
    const entry = DRIVER_MANIFEST.find(entry => entry.type === 'background_task' && entry.slash === normalized);
    if (entry && entry.type === 'background_task') {
        return entry;
    }
    return undefined;
};

export const getDriverByCliName = (cliName: string): ViewDriverEntry | undefined => {
    const normalizedCliName = cliName.toLowerCase();
    const entry = DRIVER_MANIFEST.find(entry => 
        entry.type === 'view' && 
        (entry.id.toLowerCase() === normalizedCliName || 
         entry.label.toLowerCase().replace(/\s/g, '-') === normalizedCliName)
    );
    if (entry && entry.type === 'view') {
        return entry;
    }
    return undefined;
};
