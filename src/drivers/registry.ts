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
import { buildPromptAgentStart } from '../agent/runtime/runPromptAgentStart.js';
import { uiReviewDriverEntry } from './ui-review/index.js';

// import { buildUiReviewSystemPrompt } from './ui-review/prompt.js'; // No longer needed here
import { storyDriverEntry } from './story/index.js';
import { createStoryPromptAgent } from './story/agent.js';
import { glossaryDriverEntry } from './glossary/index.js';
import { createLogMonitor } from '../agents/log-monitor/index.js';
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
    return [
    // Background Task Drivers
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
                    // Build a minimal runnable agent that forwards prompt and injects provided sub-agents
                    const adapter = {
                        getPrompt: (userInput: string) => userInput,
                        getAgentDefinitions: () => options?.agents as any,
                    };
                    const agent = {
                        id: 'plan-review-do',
                        description: 'Ephemeral agent for Plan-Review-Do workflow',
                        start: buildPromptAgentStart(adapter),
                    } as any;
                    const result = context.startBackground(
                        agent,
                        prompt,
                        {
                            sourceTabId: context.sourceTabId || 'Plan-Review-DO',
                            workspacePath: context.workspacePath,
                            timeoutSec: 900,
                            session: context.session,
                        }
                    );
                    return { id: result.task.id };
                },
                waitTask: context.waitTask,
            });
        },
    },
    {
        type: 'background_task',
        id: Driver.LOG_MONITOR,
        label: Driver.LOG_MONITOR,
        slash: 'bg:log-monitor',
        description: '监控 debug.log 文件变化并推送摘要',
        requiresSession: true,
        handler: async (message: Message, context: DriverRuntimeContext) => {
            addLog('[LogMonitor] Handler starting');
            addLog(`[LogMonitor] Message: ${message.content}`);
            addLog(`[LogMonitor] Workspace: ${context.workspacePath ?? '(none)'}`);
            addLog(`[LogMonitor] SourceTab: ${String(context.sourceTabId)}`);
            addLog(`[LogMonitor] startBackground: ${typeof (context as any).startBackground}`);
            
            // Create LogMonitor agent instance
            const logMonitor = createLogMonitor('debug.log', 100, 30);
            addLog(`[LogMonitor] Agent created: ${logMonitor.id}`);
            
            // Create task with agent (using startBackground if available)
            if ('startBackground' in context && typeof (context as any).startBackground === 'function') {
                addLog('[LogMonitor] Using startBackground');
                try {
                    const result = (context as any).startBackground(
                        logMonitor,
                        message.content,
                        {
                            sourceTabId: (context as any).sourceTabId || 'unknown',
                            workspacePath: context.workspacePath,
                            timeoutSec: 3600, // 1 hour default
                            session: (context as any).session, // Pass session from runtime context
                        }
                    );
                    addLog(`[LogMonitor] Task created: ${result.task.id}`);
                    
                    const { task, emitter } = result;
                    
                    // Subscribe to events and push to source tab
                    const levelIcons = { info: 'ℹ️', warning: '⚠️', error: '❌' };
                    emitter.on('event', (event: any) => {
                        try { addLog(`[LogMonitor] Event: ${JSON.stringify(event)}`); } catch {}
                        const icon = levelIcons[event.level as keyof typeof levelIcons] || '📝';
                        const systemMsg: Message = {
                            id: context.nextMessageId(),
                            role: 'system',
                            content: `${icon} [Log Monitor] ${event.message}`,
                            isBoxed: event.level === 'error',
                        };
                        context.setFrozenMessages(prev => [...prev, systemMsg]);
                    });
                    
                    emitter.on('completed', () => {
                        addLog('[LogMonitor] Task completed');
                        const systemMsg: Message = {
                            id: context.nextMessageId(),
                            role: 'system',
                            content: `✅ [Log Monitor] 监控任务已完成`,
                        };
                        context.setFrozenMessages(prev => [...prev, systemMsg]);
                    });
                    
                    emitter.on('failed', (error: string) => {
                        addLog(`[LogMonitor] Task failed: ${error}`);
                        const systemMsg: Message = {
                            id: context.nextMessageId(),
                            role: 'system',
                            content: `❌ [Log Monitor] 监控任务失败: ${error}`,
                            isBoxed: true,
                        };
                        context.setFrozenMessages(prev => [...prev, systemMsg]);
                    });
                } catch (error) {
                    addLog(`[LogMonitor] Error creating task: ${error instanceof Error ? error.stack || error.message : String(error)}`);
                    throw error;
                }
            } else {
                addLog('[LogMonitor] startBackground not available');
                const systemMsg: Message = {
                    id: context.nextMessageId(),
                    role: 'system',
                    content: `❌ [Log Monitor] 当前环境不支持后台任务接口 startBackground`,
                    isBoxed: true,
                };
                context.setFrozenMessages(prev => [...prev, systemMsg]);
            }
            
            addLog('[LogMonitor] Handler completed');
            return true;
        },
    },
    {
        type: 'background_task',
        id: Driver.STORY,
        label: 'bg:story',
        slash: 'bg:story',
        description: '在后台生成用户故事（创建 Task 标签）',
        requiresSession: true,
        handler: async (message: Message, context: DriverRuntimeContext) => {
            addLog('[bg:story] Handler starting');
            try {
                const agent = await createStoryPromptAgent();
                if ('startBackground' in context && typeof (context as any).startBackground === 'function') {
                    const result = (context as any).startBackground(
                        agent,
                        message.content,
                        {
                            sourceTabId: (context as any).sourceTabId || 'Story',
                            workspacePath: context.workspacePath,
                            timeoutSec: 600,
                            session: (context as any).session,
                        }
                    );
                    const systemMsg: Message = {
                        id: context.nextMessageId(),
                        role: 'system',
                        content: `🧵 [Story] 后台任务已创建：${result.task.id}`,
                    };
                    context.setFrozenMessages(prev => [...prev, systemMsg]);
                } else {
                    const systemMsg: Message = {
                        id: context.nextMessageId(),
                        role: 'system',
                        content: `❌ 当前环境不支持后台任务接口 startBackground` ,
                        isBoxed: true,
                    };
                    context.setFrozenMessages(prev => [...prev, systemMsg]);
                }
            } catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                const systemMsg: Message = {
                    id: context.nextMessageId(),
                    role: 'system',
                    content: `❌ [Story] 后台任务创建失败：${messageText}` ,
                    isBoxed: true,
                };
                context.setFrozenMessages(prev => [...prev, systemMsg]);
            }
            addLog('[bg:story] Handler completed');
            return true;
        },
    },
    // View Drivers
    storyDriverEntry,
    uiReviewDriverEntry,
    glossaryDriverEntry,
    {
        type: 'view',
        id: Driver.MONITOR,
        label: Driver.MONITOR,
        description: 'Monitor · 敬请期待',
        requiresSession: false,
        component: StackAgentView,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.MONITOR),
    },
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
