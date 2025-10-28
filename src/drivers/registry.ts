import type { Dispatch, SetStateAction } from 'react';

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { Message } from '../types.ts';
import type { Task } from '../../task-manager.ts';
import { Driver } from './types.ts';
import { handlePlanReviewDo } from './plan-review-do/index.ts';
import { handleStoryDriver } from './story/index.ts';

export interface DriverSessionContext {
    id: string;
    initialized: boolean;
    markInitialized: () => void;
}

export interface DriverRuntimeContext {
    nextMessageId: () => number;
    setActiveMessages: Dispatch<SetStateAction<Message[]>>;
    setFrozenMessages: Dispatch<SetStateAction<Message[]>>;
    finalizeMessageById: (messageId: number) => void;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
    workspacePath?: string;
    createTask: (prompt: string, queryOptions?: { agents?: Record<string, any> }) => Task;
    waitTask: (taskId: string) => Promise<Task>;
    session?: DriverSessionContext;
}

export type DriverHandler = (message: Message, context: DriverRuntimeContext) => Promise<boolean>;

export interface DriverManifestEntry {
    id: Driver;
    label: string;
    slash: string;
    description: string;
    handler: DriverHandler;
    requiresSession: boolean;
    isPlaceholder?: boolean;
}

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

export const DRIVER_MANIFEST: readonly DriverManifestEntry[] = [
    {
        id: Driver.PLAN_REVIEW_DO,
        label: Driver.PLAN_REVIEW_DO,
        slash: 'plan-review-do',
        description: '执行 Plan-Review-Do 工作流',
        requiresSession: false,
        handler: async (message, context) => {
            return await handlePlanReviewDo(message, {
                nextMessageId: context.nextMessageId,
                setActiveMessages: context.setActiveMessages,
                setFrozenMessages: context.setFrozenMessages,
                createTask: context.createTask,
                waitTask: context.waitTask,
            });
        },
    },
    {
        id: Driver.STORY,
        label: Driver.STORY,
        slash: 'story',
        description: 'Generate structured Stories document',
        requiresSession: true,
        handler: async (message, context) => {
            if (!context.session) {
                throw new Error('Story driver requires a Claude session context.');
            }
            return await handleStoryDriver(message, {
                nextMessageId: context.nextMessageId,
                setActiveMessages: context.setActiveMessages,
                setFrozenMessages: context.setFrozenMessages,
                finalizeMessageById: context.finalizeMessageById,
                canUseTool: context.canUseTool,
                workspacePath: context.workspacePath,
                session: context.session,
            });
        },
    },
    {
        id: Driver.UX,
        label: Driver.UX,
        slash: 'ux',
        description: 'UX driver · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.UX),
    },
    {
        id: Driver.ARCHITECTURE,
        label: Driver.ARCHITECTURE,
        slash: 'architecture',
        description: 'Architecture driver · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.ARCHITECTURE),
    },
    {
        id: Driver.TECH_PLAN,
        label: Driver.TECH_PLAN,
        slash: 'tech-plan',
        description: 'Tech Plan driver · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.TECH_PLAN),
    },
] as const;

export const DRIVER_TABS: readonly Driver[] = DRIVER_MANIFEST.map(entry => entry.label as Driver);

export const getDriverBySlash = (slashName: string): DriverManifestEntry | undefined => {
    const normalized = slashName.toLowerCase();
    return DRIVER_MANIFEST.find(entry => entry.slash === normalized);
};

export const getDriverByLabel = (label: string): DriverManifestEntry | undefined => {
    return DRIVER_MANIFEST.find(entry => entry.label === label);
};

export const getDriverCommandEntries = (): { name: string; description: string }[] => {
    return DRIVER_MANIFEST.map(entry => ({
        name: entry.slash,
        description: entry.description,
    }));
};
