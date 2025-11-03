import type { Dispatch, SetStateAction } from 'react';

import type { AgentDefinition, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { Message } from '../types.js';
import type { Task } from '../../task-manager.js';
import { Driver } from './types.js';
import { handlePlanReviewDo } from './plan-review-do/index.js';
import { buildUiReviewSystemPrompt } from './ui-review/prompt.js';
import type { DriverPrepareResult } from './pipeline.js';
import { prepareStoryAgentInvocation } from './story/utils.js';

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

export type DriverPrepareFn = (
    prompt: string,
    context: DriverRuntimeContext
) => Promise<DriverPrepareResult | null>;

interface BaseDriverManifestEntry {
    id: Driver;
    label: string;
    slash: string;
    description: string;
    requiresSession: boolean;
    isPlaceholder?: boolean;
}

/**
 * Driver that uses the agent pipeline for execution.
 * 
 * Use this type when:
 * - The driver needs to leverage Claude's agent capabilities (tool use, permission management, etc.)
 * - The driver requires structured conversation flow with tool events and placeholders
 * - You want to customize system prompts, allowed/disallowed tools, or permission modes
 * 
 * When useAgentPipeline is true, the handler field is optional and will be ignored at runtime.
 * The agent pipeline handles message processing through the Claude SDK instead.
 * 
 * @example
 * {
 *   id: Driver.STORY,
 *   label: Driver.STORY,
 *   slash: 'story',
 *   description: 'Story Orchestration',
 *   requiresSession: true,
 *   useAgentPipeline: true,
 *   pipelineOptions: {
 *     allowedTools: ['Read', 'Write', 'Edit'],
 *   }
 * }
 */
interface AgentPipelineDriverEntry extends BaseDriverManifestEntry {
    useAgentPipeline: true;
    pipelineOptions?: {
        systemPromptFactory?: () => string;
        allowedTools?: string[];
        disallowedTools?: string[];
        permissionMode?: string;
        agents?: Record<string, AgentDefinition>;
    };
    pipelineFlowId?: string;
    prepare?: DriverPrepareFn;
    handler?: DriverHandler;
}

/**
 * Driver that uses a custom handler function for execution.
 * 
 * Use this type when:
 * - The driver implements custom message processing logic
 * - You need direct control over message handling and state management
 * - The driver doesn't require agent pipeline features
 * 
 * When useAgentPipeline is false or undefined, the handler field is required.
 * The handler receives user messages and has full access to the runtime context.
 * 
 * @example
 * {
 *   id: Driver.PLAN_REVIEW_DO,
 *   label: Driver.PLAN_REVIEW_DO,
 *   slash: 'plan-review-do',
 *   description: 'Execute Plan-Review-Do workflow',
 *   requiresSession: false,
 *   handler: async (message, context) => {
 *     // Custom processing logic
 *     return true;
 *   }
 * }
 */
interface HandlerDriverEntry extends BaseDriverManifestEntry {
    useAgentPipeline?: false;
    handler: DriverHandler;
}

/**
 * Discriminated union type for driver manifest entries.
 * 
 * This union enforces at the type level that drivers either use the agent pipeline
 * (AgentPipelineDriverEntry) or a custom handler (HandlerDriverEntry), preventing
 * confusion where both might be specified but only one is used at runtime.
 */
export type DriverManifestEntry = AgentPipelineDriverEntry | HandlerDriverEntry;

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
        id: Driver.GLOSSARY,
        label: Driver.GLOSSARY,
        slash: 'glossary',
        description: 'Glossary · 敬请期待',
        requiresSession: false,
        isPlaceholder: true,
        handler: createPlaceholderHandler(Driver.GLOSSARY),
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
        prepare: async (prompt, context) => {
            return await prepareStoryAgentInvocation(prompt, context.workspacePath);
        },
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

export const DRIVER_TABS: readonly Driver[] = DRIVER_MANIFEST.filter(entry => entry.id !== Driver.PLAN_REVIEW_DO).map(entry => entry.label as Driver);

export const getDriverBySlash = (slashName: string): DriverManifestEntry | undefined => {
    const normalized = slashName.toLowerCase();
    return DRIVER_MANIFEST.find(entry => entry.slash === normalized);
};

export const getDriverByLabel = (label: string): DriverManifestEntry | undefined => {
    return DRIVER_MANIFEST.find(entry => entry.label === label);
};

export const getDriverCommandEntries = (): { name: string; description: string }[] => {
    const tabIds = new Set(DRIVER_TABS);
    return DRIVER_MANIFEST.filter(entry => !tabIds.has(entry.id)).map(entry => ({
        name: entry.slash,
        description: entry.description,
    }));
};
