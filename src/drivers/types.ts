import type React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentDefinition, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Task } from '../../task-manager.js';
import type { Message } from '../types.js';
import type { DriverPrepareResult } from './pipeline.js';

export enum Driver {
    CHAT = 'Chat',
    AGENT = 'Agent',
    PLAN_REVIEW_DO = 'Plan-Review-DO',
    GLOSSARY = 'Glossary',
    STORY = 'Story',
    UI_REVIEW = 'UI Review',
    LOGIC_REVIEW = 'Logic Review',
    DATA_REVIEW = 'Data Review',
}

export type DriverName =
    | 'chat'
    | 'agent'
    | 'plan-review-do'
    | 'glossary'
    | 'story'
    | 'ui-review'
    | 'logic-review'
    | 'data-review';

export interface ViewDriverProps {
    isActive: boolean;
    label: string;
}

// --- Driver Runtime and Handler Types ---

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


// --- Driver Manifest Entry Types ---

interface BaseDriverEntry {
    id: Driver;
    label: string;
}

export interface ViewDriverEntry extends BaseDriverEntry {
    type: 'view';
    component: React.FC<ViewDriverProps>;
    description: string;
    requiresSession: boolean;
    isPlaceholder?: boolean;
    useAgentPipeline?: boolean;
    pipelineOptions?: {
        systemPromptFactory?: () => string;
        allowedTools?: string[];
        disallowedTools?: string[];
        permissionMode?: string;
        agents?: Record<string, AgentDefinition>;
    };
    prepare?: DriverPrepareFn;
    handler?: DriverHandler;
}

export interface BackgroundTaskDriverEntry extends BaseDriverEntry {
    type: 'background_task';
    slash: string;
    description: string;
    requiresSession: boolean;
    handler: DriverHandler;
}

export type DriverManifestEntry = ViewDriverEntry | BackgroundTaskDriverEntry;
