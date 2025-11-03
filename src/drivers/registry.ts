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
import { uiReviewDriverEntry } from './ui-review/index.js';

// import { buildUiReviewSystemPrompt } from './ui-review/prompt.js'; // No longer needed here
import { storyDriverEntry } from './story/index.js';
import { glossaryDriverEntry } from './glossary/index.js';

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
    // Background Task Driver
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
                createTask: context.createTask,
                waitTask: context.waitTask,
            });
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
    const entry = DRIVER_MANIFEST.find(entry => entry.label === label);
    if (entry && entry.type === 'view') {
        return entry;
    }
    return undefined;
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
