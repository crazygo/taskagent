import type React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentDefinition, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Task, TaskWithEmitter } from '@taskagent/shared/task-manager';
import type { Message } from '../types.js';
import type { DriverPrepareResult } from './pipeline.js';

export enum Driver {
    CHAT = 'Chat',
    AGENT = 'Agent',
    PLAN_REVIEW_DO = 'Plan-Review-DO',
    GLOSSARY = 'Glossary',
    STORY = 'Story',
    UI = 'UI',
    MONITOR = 'Monitor',
    LOG_MONITOR = 'Log Monitor',
}

export const DRIVER_NAMES = [
    'chat',
    'agent',
    'plan-review-do',
    'glossary',
    'story',
    'ui',
    'monitor',
    'log-monitor',
] as const;

export type DriverName = (typeof DRIVER_NAMES)[number];

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
    sourceTabId?: string;
    startBackground: (
        agent: any,
        userPrompt: string,
        context: { sourceTabId?: string; workspacePath?: string; timeoutSec?: number; session?: { id: string; initialized: boolean }; forkSession?: boolean }
    ) => TaskWithEmitter;
    startForeground: (
        agent: any,
        userPrompt: string,
        context: { sourceTabId: string; workspacePath?: string; session?: { id: string; initialized: boolean }; forkSession?: boolean },
        sinks: {
            onText: (chunk: string) => void;
            onReasoning?: (chunk: string) => void;
            onEvent?: (e: { level: 'info'|'warning'|'error'; message: string; ts: number }) => void;
            onCompleted?: (fullText: string) => void;
            onFailed?: (error: string) => void;
            canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
        }
    ) => { cancel: () => void; sessionId: string };
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
