import type { Dispatch, SetStateAction } from 'react';

import type { AgentDefinition, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { Message } from '../types.ts';
import type { Task } from '../../task-manager.ts';
import { Driver } from './types.ts';
import { handlePlanReviewDo } from './plan-review-do/index.ts';
import { buildUiReviewSystemPrompt } from './ui-review/prompt.ts';

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
    requiresSession: boolean;
    isPlaceholder?: boolean;
    // If true, use Agent pipeline (queue, placeholders, tool events) and ignore handler
    useAgentPipeline?: boolean;
    pipelineOptions?: {
        systemPromptFactory?: () => string;
        allowedTools?: string[];
        disallowedTools?: string[];
        permissionMode?: string;
        agents?: Record<string, AgentDefinition>;
    };
    pipelineFlowId?: string;
    handler: DriverHandler;
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
        description: 'Story Orchestration · 整理、审阅并沉淀到 Markdown',
        requiresSession: true,
        useAgentPipeline: true,
        pipelineFlowId: 'story',
        pipelineOptions: {
            allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            disallowedTools: ['Bash', 'NotebookEdit', 'TodoWrite'],
        },
        handler: createPlaceholderHandler(Driver.STORY),
    },
    {
        id: Driver.UI_REVIEW,
        label: Driver.UI_REVIEW,
        slash: 'ui-review',
        description: 'UI Review · 输出 ASCII 线框 + 注释',
        requiresSession: true,
        // Prefer to use agent pipeline for UI Review to match visuals/queue/permissions
        useAgentPipeline: true,
        pipelineOptions: {
            systemPromptFactory: () => buildUiReviewSystemPrompt(),
            allowedTools: ['Read', 'Grep', 'Glob'],
            disallowedTools: ['Write', 'Edit', 'Bash', 'NotebookEdit', 'FileWrite', 'FileEdit', 'TodoWrite'],
        },
        handler: createPlaceholderHandler(Driver.UI_REVIEW),
    },
    {
        id: Driver.USER_FLOW_REVIEW,
        label: Driver.USER_FLOW_REVIEW,
        slash: 'user-flow-review',
        description: 'User Flow Review · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.USER_FLOW_REVIEW),
    },
    {
        id: Driver.LOGIC_REVIEW,
        label: Driver.LOGIC_REVIEW,
        slash: 'logic-review',
        description: 'Logic Review · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.LOGIC_REVIEW),
    },
    {
        id: Driver.DATA_REVIEW,
        label: Driver.DATA_REVIEW,
        slash: 'data-review',
        description: 'Data Review · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.DATA_REVIEW),
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
