#!/usr/bin/env node

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { randomUUID } from 'crypto';
import { inspect } from 'util';
import { type AgentDefinition, type PermissionUpdate, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import { addLog } from './src/logger.js';
import { createBaseClaudeFlow, type BaseClaudeFlow } from './src/agent/flows/baseClaudeFlow.js';
import { loadCliConfig } from './src/cli/config.js';
import type { Task } from './task-manager.js';
import { ensureAiProvider, type AiChatProvider } from './src/config/ai-provider.js';
import * as Types from './src/types.js';
import { ChatPanel } from './src/components/ChatPanel.js';
import { TabView } from './src/components/StatusControls.js';
import { TaskSpecificView } from './src/components/TaskSpecificView.js';
import { InputBar } from './src/components/InputBar.js';
import type { AgentPermissionPromptState, AgentPermissionOption } from './src/components/AgentPermissionPrompt.types.js';
import { AgentPermissionPromptComponent } from './src/components/AgentPermissionPrompt.js';
import { useTaskStore } from './src/domain/taskStore.js';
import { useConversationStore } from './src/domain/conversationStore.js';
import {
    Driver,
    type DriverManifestEntry,
    type ViewDriverEntry,
    type BackgroundTaskDriverEntry,
    type DriverRuntimeContext,
} from './src/drivers/types.js';
import {
    DRIVER_TABS,
    getDriverBySlash,
    getDriverByLabel,
    getDriverByCliName,
    getDriverCommandEntries,
} from './src/drivers/registry.js';
import type { AgentPipelineOverrides } from './src/drivers/pipeline.js';
import { closeTaskLogger } from './src/task-logger.js';
import { loadWorkspaceSettings, writeWorkspaceSettings, type WorkspaceSettings } from './src/workspace/settings.js';
import { DriverView } from './src/components/DriverView.js';

// Guard to prevent double submission in dev double-mount scenarios
let __nonInteractiveSubmittedOnce = false;

const STATIC_TABS: readonly string[] = [
    Driver.CHAT,
    Driver.AGENT,
    ...DRIVER_TABS,
];

const BASE_COMMANDS: readonly { name: string; description: string }[] = [
    { name: 'newsession', description: 'Start a fresh Claude agent session' },
];

type AgentTurnOverrides = AgentPipelineOverrides;

type AgentPromptJob = {
    rawInput: string;
    prompt: string;
    sessionId: string;
    pendingMessageIds?: number[];
    overrides?: AgentTurnOverrides;
    flowId?: string;
};

type AgentPermissionRequest = {
    id: number;
    toolName: string;
    input: Record<string, unknown>;
    suggestions?: PermissionUpdate[];
    summary: string;
    complete: (result: PermissionResult) => void;
    cancel: () => void;
    placeholderMessageId?: number;
};

type E2EAutomationStep =
    | { action: 'wait'; ms?: number }
    | { action: 'press'; key: 'ctrl+n'; delayMs?: number; repeat?: number }
    | { action: 'switchTab'; tab: string; delayMs?: number }
    | { action: 'submit'; text: string; waitForStream?: boolean; timeoutMs?: number; preDelayMs?: number; postDelayMs?: number }
    | { action: 'exit'; code?: number; delayMs?: number };

type AgentPermissionDecision =
    | { kind: 'allow'; always?: boolean }
    | { kind: 'deny'; reason?: string; interrupt?: boolean };

const formatSessionId = (sessionId: string) =>
  sessionId.length > 8 ? `${sessionId.slice(0, 8)}...` : sessionId;

const formatErrorForDisplay = (error: unknown, seen: WeakSet<object> = new WeakSet()): string | null => {
    if (typeof error === 'object' && error !== null) {
        const objectError = error as object;
        if (seen.has(objectError)) {
            return null;
        }
        seen.add(objectError);
    }

    if (error instanceof Error) {
        const sections: string[] = [];
        const stack = error.stack;
        if (stack) {
            const stackLines = stack.split('\n');
            const stackBody = stackLines.length > 1 ? stackLines.slice(1).join('\n').trim() : '';
            if (stackBody) {
                sections.push(`stack:\n${stackBody}`);
            }
        }

        const maybeDetails = error as Error & {
            stderr?: string;
            stdout?: string;
            cause?: unknown;
            [key: string]: unknown;
        };

        if (typeof maybeDetails.stderr === 'string' && maybeDetails.stderr.trim()) {
            sections.push(`stderr:\n${maybeDetails.stderr.trim()}`);
        }
        if (typeof maybeDetails.stdout === 'string' && maybeDetails.stdout.trim()) {
            sections.push(`stdout:\n${maybeDetails.stdout.trim()}`);
        }
        if (maybeDetails.cause) {
            const causeDetails = formatErrorForDisplay(maybeDetails.cause, seen);
            if (causeDetails && causeDetails.trim()) {
                sections.push(`cause:\n${causeDetails.trim()}`);
            }
        }

        const ownKeys = Object.getOwnPropertyNames(error).filter(key =>
            !['name', 'message', 'stack', 'cause', 'stderr', 'stdout'].includes(key)
        );
        for (const key of ownKeys) {
            const value = maybeDetails[key];
            if (value !== undefined) {
                sections.push(`${key}:\n${inspect(value, { depth: 4 })}`);
            }
        }

        if (sections.length === 0) {
            return null;
        }
        return sections.join('\n\n');
    }

    if (typeof error === 'object' && error !== null) {
        return inspect(error, { depth: 4 });
    }

    return typeof error === 'string' ? error : String(error);
};

const formatToolInputSummary = (input: Record<string, unknown>, maxLength = 600): string => {
    try {
        const json = JSON.stringify(input, null, 2);
        if (!json) {
            return '(empty input)';
        }
        if (json.length <= maxLength) {
            return json;
        }
        return `${json.slice(0, maxLength)}…`;
    } catch {
        return '(unable to display tool input)';
    }
};

// Agent flow registry type with required default key
type AgentFlowRegistry = Record<string, BaseClaudeFlow> & {
    default: BaseClaudeFlow;
};

// --- Components ---

const App = () => {
    const [{ config: bootstrapConfig, provider, modelName, reasoningEnabled, error: bootstrapError }] = useState<{
        config: ReturnType<typeof loadCliConfig> | null;
        provider: AiChatProvider | null;
        modelName: string | null;
        reasoningEnabled: boolean | null;
        error: string | null;
    }>(() => {
        try {
            const config = loadCliConfig();
            const { provider, modelName, reasoningEnabled } = ensureAiProvider();
            addLog('Bootstrap succeeded.');
            return { config, provider, modelName, reasoningEnabled, error: null };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            addLog(`Bootstrap error: ${message}`);
            return { config: null, provider: null, modelName: null, reasoningEnabled: null, error: message };
        }
    });

    useEffect(() => {
        if (!bootstrapError) {
            return;
        }
        const timer = setTimeout(() => {
            process.exit(1);
        }, 100);
        return () => clearTimeout(timer);
    }, [bootstrapError]);

    if (bootstrapError || !bootstrapConfig || !provider || !modelName) {
        const message = bootstrapError ?? 'Initialization failed.';
        return (
            <Box borderStyle="round" borderColor="red" padding={1} flexDirection="column">
                <Text color="red">{`Error: ${message}`}</Text>
                <Text color="gray">Ensure required environment variables are set and retry.</Text>
            </Box>
        );
    }

    const nonInteractiveInput = bootstrapConfig.prompt;
    const e2eSteps = useMemo<E2EAutomationStep[] | null>(() => {
        const raw = process.env.E2E_AUTOMATION_STEPS;
        if (!raw) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter(step => step && typeof step === 'object') as E2EAutomationStep[];
            }
            addLog('[E2E] E2E_AUTOMATION_STEPS must be a JSON array.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`[E2E] Failed to parse E2E_AUTOMATION_STEPS: ${message}`);
        }
        return null;
    }, []);

    // --- STATE ---
    const [frozenMessages, setFrozenMessages] = useState<Types.Message[]>([]);
    const [activeMessages, setActiveMessages] = useState<Types.Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [selectedTab, setSelectedTab] = useState<string>(Driver.CHAT);
    const [focusedControl, setFocusedControl] = useState<'input' | 'tabs' | 'task' | 'permission'>('input');
    const [isCommandMenuShown, setIsCommandMenuShown] = useState(false);
    const [isEscActive, setIsEscActive] = useState(false);
    const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
    const [, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
    const [isAgentStreaming, setIsAgentStreaming] = useState(false);
    const { tasks, startBackground, waitTask, cancelTask, startForeground } = useTaskStore();
    const [positionalPromptWarning, setPositionalPromptWarning] = useState<string | null>(null);

    const automationRanRef = useRef(false);
    const handleSubmitRef = useRef<((input: string) => Promise<boolean>) | null>(null);
    const tasksRef = useRef(tasks);
    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        if (bootstrapConfig?.driver) {
            const driver = getDriverByCliName(bootstrapConfig.driver);
            if (driver) {
                addLog(`[Driver Init] Setting driver from CLI: ${driver.label}`);
                setSelectedTab(driver.label);
            }
        }
    }, [bootstrapConfig?.driver]);

    // --- REFS ---
    const hasProcessedNonInteractiveRef = useRef(false);
    const {
        isStreaming,
        runStreamForUserMessage,
        pendingUserInputsRef,
        isProcessingQueueRef,
        flushPendingQueue,
        nextMessageId,
    } = useConversationStore({
        aiProvider: provider,
        modelName,
        reasoningEnabled: reasoningEnabled || false,
        onActiveMessagesChange: setActiveMessages,
        onFrozenMessagesChange: setFrozenMessages,
    });

    const selectedTabRef = useRef(selectedTab);
    useEffect(() => {
        selectedTabRef.current = selectedTab;
    }, [selectedTab]);

    const isStreamingRef = useRef(isStreaming);
    useEffect(() => {
        isStreamingRef.current = isStreaming;
    }, [isStreaming]);

    const prevTasksLengthRef = useRef(tasks.length);
    const agentWorkspaceStatusRef = useRef<{ missingNotified: boolean; errorNotified: boolean }>({
        missingNotified: false,
        errorNotified: false,
    });
    const lastAnnouncedAgentSessionRef = useRef<string | null>(null);
    const agentSessionInitializedRef = useRef<boolean>(false);
    const agentPendingQueueRef = useRef<AgentPromptJob[]>([]);
    const forcedSessionPromiseRef = useRef<Promise<string | null> | null>(null);
    const shouldForceNewSessionRef = useRef<boolean>(bootstrapConfig?.newSession ?? false);
    const bootstrapNewSessionAppliedRef = useRef<boolean>(false);
    const agentPermissionRequestsRef = useRef<Map<number, AgentPermissionRequest>>(new Map());
    const nextAgentPermissionIdRef = useRef<number>(1);
const agentPermissionQueueRef = useRef<number[]>([]);
const [agentPermissionPrompt, setAgentPermissionPrompt] = useState<AgentPermissionPromptState | null>(null);
const lastAnnouncedDriverRef = useRef<string | null>(null);

    const finalizeActiveMessages = useCallback(() => {
        setActiveMessages(prev => {
            if (prev.length === 0) {
                return prev;
            }
            const completed = prev.filter(msg => !msg.isPending);
            if (completed.length > 0) {
                setFrozenMessages(frozen => [...frozen, ...completed]);
            }
            return prev.filter(msg => msg.isPending);
        });
    }, [setActiveMessages, setFrozenMessages]);

    const finalizeMessageById = useCallback((messageId: number) => {
        setActiveMessages(prev => {
            const messageToFinalize = prev.find(msg => msg.id === messageId);
            if (messageToFinalize) {
                setFrozenMessages(frozen => [...frozen, { ...messageToFinalize, isPending: false }]);
            }
            return prev.filter(msg => msg.id !== messageId);
        });
    }, [setActiveMessages, setFrozenMessages]);

    const appendSystemMessage = useCallback((content: string, boxed = false, shouldFinalize = true) => {
        if (shouldFinalize) {
            finalizeActiveMessages();
        }
        const systemMessage: Types.Message = {
            id: nextMessageId(),
            role: 'system',
            content,
            isBoxed: boxed,
        };
        if (shouldFinalize) {
            setFrozenMessages(prev => [...prev, systemMessage]);
        } else {
            setActiveMessages(prev => [...prev, systemMessage]);
        }
    }, [finalizeActiveMessages, nextMessageId, setFrozenMessages, setActiveMessages]);

    useEffect(() => {
        if (!STATIC_TABS.includes(selectedTab) || selectedTab === Driver.CHAT || selectedTab === Driver.AGENT) {
            lastAnnouncedDriverRef.current = null;
            return;
        }

        const driverEntry = getDriverByLabel(selectedTab);
        if (!driverEntry) {
            lastAnnouncedDriverRef.current = null;
            return;
        }

        if (lastAnnouncedDriverRef.current !== driverEntry.label) {
            appendSystemMessage(`[${driverEntry.label}] view is active.`);
            lastAnnouncedDriverRef.current = driverEntry.label;
        }
    }, [appendSystemMessage, selectedTab]);

    useEffect(() => {
        if (!bootstrapConfig.ignoredPositionalPrompt) {
            setPositionalPromptWarning(null);
            return;
        }
        setPositionalPromptWarning(
            `⚠️ A prompt was provided without the '-p' or '--prompt' flag and has been ignored. ` +
                `To submit a prompt on startup, please use the correct flag. ` +
                `Example: yarn start -- --glossary -p "Your prompt here"`
        );
    }, [bootstrapConfig.ignoredPositionalPrompt]);

    const activateNextAgentPermissionPrompt = useCallback(() => {
        const queue = agentPermissionQueueRef.current;
        while (queue.length > 0) {
            const nextId = queue.shift()!;
            const nextRequest = agentPermissionRequestsRef.current.get(nextId);
            if (!nextRequest) {
                continue;
            }
            setAgentPermissionPrompt({
                requestId: nextId,
                toolName: nextRequest.toolName,
                summary: nextRequest.summary,
                hasSuggestions: Boolean(nextRequest.suggestions && nextRequest.suggestions.length > 0),
            });
            return;
        }
        setAgentPermissionPrompt(null);
    }, []);

    const resolveAgentPermission = useCallback((id: number, decision: AgentPermissionDecision): boolean => {
        const request = agentPermissionRequestsRef.current.get(id);
        if (!request) {
            appendSystemMessage(`[Agent] No pending permission request with id ${id}.`, true);
            return false;
        }

        const toolName = request.toolName;
        const hasSuggestions = Boolean(request.suggestions && request.suggestions.length > 0);

        // Update placeholder message
        if (request.placeholderMessageId !== undefined) {
            setActiveMessages(prev => prev.map(msg => {
                if (msg.id !== request.placeholderMessageId) {
                    return msg;
                }
                
                let resultContent: string;
                if (decision.kind === 'allow') {
                    const rememberNote = decision.always && hasSuggestions ? ' (remembered for this session)' : '';
                    resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n✅ Approved${rememberNote}`;
                } else {
                    const reason = decision.reason?.trim().length ? decision.reason.trim() : 'Denied by user';
                    resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n❌ Denied: ${reason}`;
                }
                
                const { isPending, ...msgWithoutPending } = msg;
                return {
                    ...msgWithoutPending,
                    content: resultContent,
                };
            }));
            finalizeMessageById(request.placeholderMessageId);
        }

        if (decision.kind === 'allow') {
            request.complete({
                behavior: 'allow',
                updatedInput: request.input,
                updatedPermissions: decision.always && hasSuggestions ? request.suggestions : undefined,
            });
            addLog(`[Agent] Permission #${id} approved for "${toolName}"${decision.always && hasSuggestions ? ' with remember' : ''}.`);
        } else {
            const reason = decision.reason?.trim().length ? decision.reason.trim() : 'Denied by user';
            request.complete({
                behavior: 'deny',
                message: reason,
                interrupt: decision.interrupt ?? false,
            });
            addLog(`[Agent] Permission #${id} denied for "${toolName}": ${reason}`);
        }
        return true;
    }, [appendSystemMessage, setActiveMessages, finalizeMessageById]);

    const handleAgentPermissionCommand = useCallback((input: string): boolean | null => {
        const trimmed = input.trim();
        if (!trimmed.toLowerCase().startsWith('/allow') && !trimmed.toLowerCase().startsWith('/deny')) {
            return null;
        }

        const [commandRaw, ...argTokens] = trimmed.split(/\s+/);
        if (!commandRaw) return null;
        const command = commandRaw.toLowerCase();

        if (argTokens.length < 1) {
            appendSystemMessage(command === '/allow' ? 'Usage: /allow <id> [always]' : 'Usage: /deny <id> [reason]', true);
            return false;
        }

        const [idToken, ...restTokens] = argTokens;
        if (!idToken) {
            appendSystemMessage('[Agent] Permission id must be provided.', true);
            return false;
        }

        const id = Number.parseInt(idToken, 10);
        if (Number.isNaN(id)) {
            appendSystemMessage('[Agent] Permission id must be an integer.', true);
            return false;
        }

        if (command === '/allow') {
            const always = restTokens.some(token => token.toLowerCase() === 'always' || token.toLowerCase() === '--always');
            return resolveAgentPermission(id, { kind: 'allow', always });
        }

        const reason = restTokens.join(' ').trim();
        return resolveAgentPermission(id, { kind: 'deny', reason });
    }, [appendSystemMessage, resolveAgentPermission]);

    const handleAgentPermissionRequest = useCallback(
        (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => {
            const { signal, suggestions } = options;
            const requestId = nextAgentPermissionIdRef.current++;
            const summary = formatToolInputSummary(input);

            const placeholderMessageId = nextMessageId();
            const placeholderMessage: Types.Message = {
                id: placeholderMessageId,
                role: 'system',
                content: `[Agent] Waiting for permission #${requestId} on "${toolName}"…`,
                isPending: true,
            };
            setActiveMessages(prev => {
                const newMessages = [...prev];
                const lastMessage = newMessages.length > 0 ? newMessages[newMessages.length - 1] : null;
                if (lastMessage && lastMessage.role === 'assistant') {
                    newMessages.splice(newMessages.length - 1, 0, placeholderMessage);
                } else {
                    newMessages.push(placeholderMessage);
                }
                return newMessages;
            });

            addLog(`[Agent] Permission request #${requestId} pending for tool "${toolName}".`);

            return new Promise<PermissionResult>(resolve => {
                let settled = false;
                const finalize = (result: PermissionResult) => {
                    if (settled) return;
                    settled = true;
                    signal.removeEventListener('abort', abortHandler);
                    agentPermissionRequestsRef.current.delete(requestId);
                    agentPermissionQueueRef.current = agentPermissionQueueRef.current.filter(id => id !== requestId);
                    resolve(result);
                    setAgentPermissionPrompt(prev => (prev && prev.requestId === requestId ? null : prev));
                    activateNextAgentPermissionPrompt();
                };

                const abortHandler = () => {
                    if (!agentPermissionRequestsRef.current.has(requestId)) return;
                    setActiveMessages(prev => prev.filter(msg => msg.id !== placeholderMessageId));
                    appendSystemMessage(`[Agent] Permission request #${requestId} was cancelled by the agent.`, true);
                    addLog(`[Agent] Permission request #${requestId} cancelled by agent/runtime.`);
                    finalize({ behavior: 'deny', message: 'Permission request cancelled.', interrupt: false });
                };

                agentPermissionRequestsRef.current.set(requestId, {
                    id: requestId, toolName, input, suggestions, summary, placeholderMessageId,
                    complete: finalize,
                    cancel: () => finalize({ behavior: 'deny', message: 'Permission request cancelled.', interrupt: false }),
                });

                agentPermissionQueueRef.current.push(requestId);
                if (!agentPermissionPrompt) {
                    activateNextAgentPermissionPrompt();
                }

                if (signal.aborted) {
                    abortHandler();
                } else {
                    signal.addEventListener('abort', abortHandler, { once: true });
                }
            });
        },
        [activateNextAgentPermissionPrompt, agentPermissionPrompt, nextMessageId, appendSystemMessage, setActiveMessages]
    );

    const handlePermissionPromptSubmit = useCallback(
        (option: AgentPermissionOption) => {
            if (!agentPermissionPrompt) return;
            const decision: AgentPermissionDecision = option === 'deny' 
                ? { kind: 'deny' } 
                : { kind: 'allow', always: option === 'always' };
            resolveAgentPermission(agentPermissionPrompt.requestId, decision);
        },
        [agentPermissionPrompt, resolveAgentPermission]
    );

    const baseClaudeFlow = useMemo(
        () => createBaseClaudeFlow({
            nextMessageId,
            setActiveMessages,
            finalizeMessageById,
            canUseTool: handleAgentPermissionRequest,
            workspacePath: bootstrapConfig?.workspacePath,
        }),
        [nextMessageId, setActiveMessages, finalizeMessageById, handleAgentPermissionRequest, bootstrapConfig?.workspacePath]
    );

    const agentFlowRegistry: AgentFlowRegistry = useMemo(() => ({
        default: baseClaudeFlow,
        story: baseClaudeFlow,
    }), [baseClaudeFlow]);

    const driverCommandEntries = useMemo(() => getDriverCommandEntries(), []);
    const inputCommands = useMemo(() => [...BASE_COMMANDS, ...driverCommandEntries], [driverCommandEntries]);

    useEffect(() => {
        if (agentPermissionPrompt) {
            setFocusedControl('permission');
            setInputValue('');
        } else if (focusedControl === 'permission') {
            setFocusedControl('input');
        }
    }, [agentPermissionPrompt, focusedControl]);

    useEffect(() => {
        if (tasks.length > prevTasksLengthRef.current) {
            const newTaskIndex = tasks.length - 1;
            setSelectedTab(`Task ${newTaskIndex + 1}`);
        }
        prevTasksLengthRef.current = tasks.length;
    }, [tasks]);

    useEffect(() => {
        const driverEntry = getDriverByLabel(selectedTab);
        const needsSession = selectedTab === Driver.AGENT || (driverEntry?.requiresSession ?? false);

        if (!needsSession) return;
        if (agentSessionId) return;
        const workspacePath = bootstrapConfig?.workspacePath;
        if (!workspacePath) {
            if (!agentWorkspaceStatusRef.current.missingNotified) {
                appendSystemMessage('[Agent] Missing workspace. Launch with --workspace <path> to retain sessions.', true);
                agentWorkspaceStatusRef.current.missingNotified = true;
            }
            return;
        }
        agentWorkspaceStatusRef.current.missingNotified = false;
        let cancelled = false;
        (async () => {
            try {
                const settings = await loadWorkspaceSettings(workspacePath);
                if (cancelled) return;
                setWorkspaceSettings(settings);
                let sessionId = settings.sessions.at(-1);
                if (!sessionId) {
                    sessionId = randomUUID();
                    const updatedSettings: WorkspaceSettings = { sessions: [...settings.sessions, sessionId] };
                    await writeWorkspaceSettings(workspacePath, updatedSettings);
                    if (cancelled) return;
                    setWorkspaceSettings(updatedSettings);
                    addLog(`[Agent] Created new session ${sessionId} for workspace ${workspacePath}`);
                    agentSessionInitializedRef.current = false;
                }
                if (cancelled) return;
                setAgentSessionId(sessionId);
                lastAnnouncedAgentSessionRef.current = null;
                agentWorkspaceStatusRef.current.errorNotified = false;
                if (settings.sessions.length > 0) {
                    agentSessionInitializedRef.current = true;
                }
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                addLog(`[Agent] Workspace initialization failed: ${message}`);
                if (!agentWorkspaceStatusRef.current.errorNotified) {
                    appendSystemMessage(`[Agent] Failed to initialize workspace: ${message}`, true);
                    agentWorkspaceStatusRef.current.errorNotified = true;
                }
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTab, bootstrapConfig?.workspacePath, agentSessionId, appendSystemMessage]);

    useEffect(() => {
        if (selectedTab !== Driver.AGENT || !agentSessionId || shouldForceNewSessionRef.current || forcedSessionPromiseRef.current || lastAnnouncedAgentSessionRef.current === agentSessionId) {
            return;
        }
        const workspacePath = bootstrapConfig?.workspacePath ?? '(no workspace)';
        appendSystemMessage(`[Agent] Using Claude session ${formatSessionId(agentSessionId)} for workspace ${workspacePath}.`);
        lastAnnouncedAgentSessionRef.current = agentSessionId;
    }, [selectedTab, agentSessionId, bootstrapConfig?.workspacePath, appendSystemMessage]);

    useInput((input, key) => {
        if (agentPermissionPrompt || (key.tab && isCommandMenuShown)) return;
        if (key.tab) {
            const newFocusOrder: Array<typeof focusedControl> = ['input', 'tabs'];
            if (activeTask) newFocusOrder.push('task');
            const currentFocusIndex = newFocusOrder.indexOf(focusedControl);
            const nextFocusIndex = (currentFocusIndex + 1) % newFocusOrder.length;
            setFocusedControl(newFocusOrder[nextFocusIndex]!);
        }
    }, { isActive: !nonInteractiveInput });

    useInput((input, key) => {
        if (process.env.E2E_SENTINEL && (input || key.ctrl || key.shift || key.meta || key.return || key.tab)) {
            const inputCode = input ? input.charCodeAt(0) : null;
            addLog(`[App] RAW INPUT: input="${input}" charCode=${inputCode} ctrl=${key.ctrl} shift=${key.shift} meta=${key.meta} tab=${key.tab} return=${key.return}`);
        }
        if (key.ctrl && (input === 'n' || input === 'N')) {
            if (process.env.E2E_SENTINEL) {
                addLog(`[App] Ctrl+N detected (focusedControl=${focusedControl}, isCommandMenuShown=${isCommandMenuShown})`);
            }
        }
    }, { isActive: !nonInteractiveInput });

    const handleEscStateChange = useCallback((isEscActive: boolean) => setIsEscActive(isEscActive), []);

    const createNewAgentSession = useCallback(async (): Promise<string | null> => {
        const workspacePath = bootstrapConfig?.workspacePath;
        if (!workspacePath) {
            appendSystemMessage('[Agent] Cannot create a new session without --workspace.', true);
            return null;
        }
        if (isAgentStreaming) {
            appendSystemMessage('[Agent] Wait for the current response to finish before creating a new session.', true);
            return null;
        }
        try {
            const settings = await loadWorkspaceSettings(workspacePath);
            const newSessionId = randomUUID();
            const updatedSettings: WorkspaceSettings = { sessions: [...settings.sessions.filter(s => typeof s === 'string' && s.trim().length > 0), newSessionId] };
            await writeWorkspaceSettings(workspacePath, updatedSettings);
            setWorkspaceSettings(updatedSettings);
            setAgentSessionId(newSessionId);
            lastAnnouncedAgentSessionRef.current = null;
            appendSystemMessage(`[Agent] Started new Claude session ${formatSessionId(newSessionId)}.`);
            addLog(`[Agent] Created new session ${newSessionId} for workspace ${workspacePath}`);
            agentSessionInitializedRef.current = false;
            return newSessionId;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendSystemMessage(`[Agent] Failed to create new session: ${message}`, true);
            addLog(`[Agent] Failed to create new session: ${message}`);
            return null;
        }
    }, [bootstrapConfig?.workspacePath, appendSystemMessage, isAgentStreaming]);

    useEffect(() => {
        if (!bootstrapConfig?.newSession || bootstrapNewSessionAppliedRef.current || !shouldForceNewSessionRef.current) return;
        bootstrapNewSessionAppliedRef.current = true;
        shouldForceNewSessionRef.current = false;
        const promise = createNewAgentSession();
        forcedSessionPromiseRef.current = promise;
        promise.finally(() => {
            if (forcedSessionPromiseRef.current === promise) {
                forcedSessionPromiseRef.current = null;
            }
        });
    }, [bootstrapConfig?.newSession, createNewAgentSession]);

    const ensureAgentSession = useCallback(async (): Promise<string | null> => {
        if (forcedSessionPromiseRef.current) {
            const pending = await forcedSessionPromiseRef.current;
            if (pending) return pending;
        }
        if (shouldForceNewSessionRef.current) {
            shouldForceNewSessionRef.current = false;
            const fresh = await createNewAgentSession();
            if (!fresh) shouldForceNewSessionRef.current = true;
            return fresh;
        }
        return agentSessionId ?? await createNewAgentSession();
    }, [agentSessionId, createNewAgentSession]);

    const startAgentPrompt = useCallback(async (job: AgentPromptJob): Promise<boolean> => {
        const { rawInput, prompt, pendingMessageIds, overrides, sessionId, flowId } = job;
        const userMessageId = nextMessageId();
        const userMessage: Types.Message = { id: userMessageId, role: 'user', content: rawInput };
        setActiveMessages(prev => [...prev.filter(msg => msg.isPending && !(pendingMessageIds?.includes(msg.id))), userMessage]);
        finalizeMessageById(userMessageId);
        setIsAgentStreaming(true);
        addLog(`[Agent] Sending prompt with session ${sessionId}: ${prompt.replace(/\s+/g, ' ').slice(0, 120)}`);
        try {
            const activeAgentFlow: BaseClaudeFlow = (flowId ? agentFlowRegistry[flowId] : undefined) ?? agentFlowRegistry.default;
            await activeAgentFlow.handleUserInput({
                prompt,
                agentSessionId: sessionId,
                sessionInitialized: agentSessionInitializedRef.current,
                ...overrides,
            });
            agentSessionInitializedRef.current = true;
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const details = formatErrorForDisplay(error);
            const combinedMessage = details ? `${message}\n${details}` : message;
            addLog(`[Agent] Error: ${combinedMessage}`);
            finalizeMessageById(userMessageId);
            appendSystemMessage(`[Agent] Error: ${combinedMessage}`, true);
            return false;
        } finally {
            setIsAgentStreaming(false);
            if (agentPendingQueueRef.current.length > 0) {
                const nextJob = agentPendingQueueRef.current.shift();
                if (nextJob) void startAgentPrompt(nextJob);
            }
        }
    }, [agentFlowRegistry, appendSystemMessage, nextMessageId, setActiveMessages, finalizeMessageById]);

    const runAgentTurn = useCallback(async (rawInput: string, overrides?: AgentTurnOverrides, sessionIdHint?: string, flowId?: string): Promise<boolean> => {
        const prompt = rawInput.trim();
        if (prompt.length === 0) return false;
        const activeSessionId = agentSessionId ?? sessionIdHint ?? null;
        if (!activeSessionId) {
            appendSystemMessage('[Agent] Session not ready yet. Switch to the Agent tab again to initialize.', true);
            return false;
        }
        if (isAgentStreaming || agentPendingQueueRef.current.length > 0) {
            const pendingUserMessageId = nextMessageId();
            const pendingAssistantMessageId = nextMessageId();
            const pendingUserMessage: Types.Message = { id: pendingUserMessageId, role: 'user', content: rawInput, isPending: true };
            const pendingAssistantMessage: Types.Message = { id: pendingAssistantMessageId, role: 'assistant', content: '', reasoning: '', isPending: true };
            setActiveMessages(prev => [...prev.filter(msg => msg.isPending), pendingUserMessage, pendingAssistantMessage]);
            agentPendingQueueRef.current.push({ rawInput, prompt, pendingMessageIds: [pendingUserMessageId, pendingAssistantMessageId], sessionId: activeSessionId, overrides, flowId });
            appendSystemMessage(`[Agent] Still processing previous request. Your message has been queued (${agentPendingQueueRef.current.length} pending).`);
            return true;
        }
        return await startAgentPrompt({ rawInput, prompt, overrides, sessionId: activeSessionId, flowId });
    }, [agentSessionId, appendSystemMessage, isAgentStreaming, nextMessageId, setActiveMessages, startAgentPrompt]);

    const runDriverEntry = useCallback(async (entry: DriverManifestEntry, prompt: string): Promise<boolean> => {
        let sessionContext = undefined as { id: string; initialized: boolean; markInitialized: () => void } | undefined;
        if (entry.requiresSession) {
            const sessionId = await ensureAgentSession();
            if (!sessionId) {
                appendSystemMessage(`[${entry.label}] Failed to initialize Claude session.`, true);
                addLog(`[Driver] Failed to ensure Claude session for ${entry.label}`);
                return false;
            }
            sessionContext = {
                id: sessionId,
                initialized: agentSessionInitializedRef.current,
                markInitialized: () => { agentSessionInitializedRef.current = true; },
            };
        }

        const runtimeContext: Omit<DriverRuntimeContext, 'session'> & { session?: typeof sessionContext } = {
            nextMessageId,
            setActiveMessages,
            setFrozenMessages,
            finalizeMessageById,
            canUseTool: handleAgentPermissionRequest,
            workspacePath: bootstrapConfig?.workspacePath,
            sourceTabId: selectedTab,
            startBackground: (agent, userPrompt, ctx) => startBackground(agent, userPrompt, ctx),
            startForeground: (agent, userPrompt, ctx, sinks) => startForeground(agent, userPrompt, ctx, sinks),
            waitTask,
            session: sessionContext,
        };

        if (entry.type === 'view' && entry.useAgentPipeline) {
            let processedPrompt = prompt;
            let overrides: AgentTurnOverrides = { ...entry.pipelineOptions };
            let flowId: string | undefined;

            if (entry.prepare) {
                try {
                    const preparation = await entry.prepare(prompt, runtimeContext);
                    if (preparation?.prompt !== undefined) processedPrompt = preparation.prompt;
                    if (preparation?.overrides) overrides = { ...overrides, ...preparation.overrides };
                    if (preparation?.flowId) flowId = preparation.flowId;
                    if (preparation?.debugLog) addLog(preparation.debugLog);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    addLog(`[Driver] ${entry.label} preparation failed: ${message}`);
                    appendSystemMessage(`[${entry.label}] ${message}`, true);
                    return false;
                }
            }
            addLog(`[Driver] Dispatching to ${entry.label} via agent pipeline${flowId ? ` (flow=${flowId})` : ''}`);
            return await runAgentTurn(processedPrompt, overrides, runtimeContext.session?.id ?? agentSessionId ?? undefined, flowId);
        }

        const userMessage: Types.Message = { id: nextMessageId(), role: 'user', content: prompt };
        try {
            addLog(`[Driver] Dispatching to ${entry.label}`);
            if (entry.type === 'background_task') {
                return await entry.handler(userMessage, runtimeContext);
            } else if (entry.type === 'view' && entry.handler) {
                return await entry.handler(userMessage, runtimeContext);
            }
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`[Driver] Error in ${entry.label}: ${message}`);
            appendSystemMessage(`[${entry.label}] Error: ${message}`, true);
            return false;
        }
    }, [agentSessionId, appendSystemMessage, bootstrapConfig?.workspacePath, ensureAgentSession, finalizeMessageById, handleAgentPermissionRequest, runAgentTurn, nextMessageId, setActiveMessages, setFrozenMessages, waitTask, startForeground, selectedTab]);

    const handleSubmit = useCallback(async (userInput: string): Promise<boolean> => {
        addLog('--- New Submission ---');
        const trimmedInput = userInput.trim();
        if (trimmedInput.length === 0) return false;

        const permissionHandled = handleAgentPermissionCommand(trimmedInput);
        if (permissionHandled !== null) {
            if (permissionHandled) setInputValue('');
            return permissionHandled;
        }

        if (trimmedInput === '/newsession') {
            setInputValue('');
            return (await createNewAgentSession()) !== null;
        }

        const slashMatch = userInput.startsWith('/') ? /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(userInput) : null;
        if (slashMatch) {
            const command = slashMatch[1]?.toLowerCase() ?? '';
            const rest = slashMatch[2] ?? '';

            const driverEntry = getDriverBySlash(command);
            if (driverEntry) {
                const prompt = rest.trim();
                if (!prompt) {
                    addLog(`[Command] /${command} requires a prompt`);
                    return false;
                }
                // Note: We don't switch tabs for background tasks
                setInputValue('');
                return await runDriverEntry(driverEntry, prompt);
            }
        }

        setInputValue('');
        const activeDriver = getDriverByLabel(selectedTab);
        if (activeDriver) {
            addLog(`[Driver] Routing to ${activeDriver.label}`);
            return await runDriverEntry(activeDriver, userInput);
        }

        if (selectedTab === Driver.AGENT) {
            return await runAgentTurn(userInput);
        }

        const newUserMessage: Types.Message = { id: nextMessageId(), role: 'user', content: userInput };
        if (selectedTab === Driver.CHAT) {
            addLog('[Driver] Using Chat mode');
        } else {
            addLog(`[Driver] Using ${selectedTab} mode (fallback to Chat)`);
        }

        if (isStreaming || isProcessingQueueRef.current) {
            addLog(`Stream in progress. Queuing user input: ${userInput}`);
            pendingUserInputsRef.current.push({ ...newUserMessage });
            setActiveMessages(prev => [...prev, { ...newUserMessage, isPending: true }]);
            return true;
        }

        let succeeded = false;
        let flushFailed = false;
        try {
            await runStreamForUserMessage(newUserMessage);
            succeeded = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`Submission error: ${message}`);
        } finally {
            if (!isProcessingQueueRef.current) {
                try {
                    await flushPendingQueue();
                } catch (flushError) {
                    const message = flushError instanceof Error ? flushError.message : String(flushError);
                    addLog(`Queue flush error: ${message}`);
                    flushFailed = true;
                }
            }
        }
        return succeeded && !flushFailed;
    }, [appendSystemMessage, createNewAgentSession, flushPendingQueue, handleAgentPermissionCommand, isProcessingQueueRef, isStreaming, nextMessageId, pendingUserInputsRef, runAgentTurn, runDriverEntry, runStreamForUserMessage, selectedTab, setInputValue]);

    useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);

    useEffect(() => {
        if (!nonInteractiveInput || hasProcessedNonInteractiveRef.current || __nonInteractiveSubmittedOnce) return;
        const desiredDriver = bootstrapConfig?.driver ? getDriverByCliName(bootstrapConfig.driver) : null;
        if (desiredDriver && selectedTab !== desiredDriver.label) return;
        hasProcessedNonInteractiveRef.current = true;
        __nonInteractiveSubmittedOnce = true;
        addLog(`Non-interactive mode: Processing input "${nonInteractiveInput}"`);
        handleSubmit(nonInteractiveInput)
            .then(success => setTimeout(() => process.exit(success ? 0 : 1), 100))
            .catch(() => setTimeout(() => process.exit(1), 100));
    }, [handleSubmit, nonInteractiveInput, selectedTab, bootstrapConfig?.driver]);

    useEffect(() => {
        if (!e2eSteps || e2eSteps.length === 0 || nonInteractiveInput || automationRanRef.current) return;
        automationRanRef.current = true;
        let cancelled = false;
        const sleep = (ms = 0) => new Promise<void>(resolve => setTimeout(() => !cancelled && resolve(), Math.max(0, ms)));
        const waitForStreamIdle = async (timeoutMs = 30000) => {
            const started = Date.now();
            while (!cancelled) {
                if (!isStreamingRef.current && !isProcessingQueueRef.current) return true;
                if (Date.now() - started > timeoutMs) {
                    addLog(`[E2E] waitForStreamIdle timed out after ${timeoutMs}ms`);
                    return false;
                }
                await sleep(100);
            }
            return false;
        };
        const getAllTabs = () => [...STATIC_TABS, ...(tasksRef.current ?? []).map((_, i) => `Task ${i + 1}`)];

        (async () => {
            addLog(`[E2E] Automation starting with ${e2eSteps.length} steps.`);
            for (const step of e2eSteps) {
                if (cancelled) break;
                switch (step.action) {
                    case 'wait': await sleep(step.ms); break;
                    case 'press':
                        if (step.key.toLowerCase() === 'ctrl+n') {
                            for (let i = 0; i < (step.repeat ?? 1) && !cancelled; i++) {
                                const tabs = getAllTabs();
                                if (tabs.length === 0) break;
                                const currentIndex = tabs.indexOf(selectedTabRef.current ?? tabs[0]!);
                                const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabs.length : 0;
                                setSelectedTab(tabs[nextIndex]!);
                                await sleep(step.delayMs ?? 200);
                            }
                        }
                        break;
                    case 'switchTab':
                        const target = getAllTabs().find(t => t.toLowerCase() === step.tab?.toLowerCase());
                        if (target) {
                            setSelectedTab(target);
                            await sleep(step.delayMs ?? 200);
                        }
                        break;
                    case 'submit':
                        setInputValue(step.text ?? '');
                        await sleep(step.preDelayMs ?? 50);
                        const submitFn = handleSubmitRef.current;
                        if (submitFn) {
                            await submitFn(step.text ?? '');
                            if (step.waitForStream !== false) await waitForStreamIdle(step.timeoutMs);
                        }
                        if (step.postDelayMs) await sleep(step.postDelayMs);
                        break;
                    case 'exit':
                        setTimeout(() => process.exit(step.code ?? 0), Math.max(0, step.delayMs ?? 500));
                        cancelled = true;
                        break;
                }
            }
        })().catch(error => addLog(`[E2E] Automation crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
        return () => { cancelled = true; };
    }, [e2eSteps, nonInteractiveInput]);

    // --- RENDER ---
    const staticTabs = STATIC_TABS;
    const taskTabs = tasks.map((_: Task, index: number) => `Task ${index + 1}`);
    
    let activeTask: Task | null = null;
    let activeTaskNumber = 0;
    if (selectedTab.startsWith('Task ')) {
        const taskIndex = parseInt(selectedTab.replace('Task ', ''), 10) - 1;
        if (taskIndex >= 0 && taskIndex < tasks.length) {
            activeTask = tasks[taskIndex]!;
            activeTaskNumber = taskIndex + 1;
        }
    }

    const isDriverViewActive = STATIC_TABS.includes(selectedTab) && selectedTab !== Driver.CHAT && selectedTab !== Driver.AGENT;

    return (
        <Box flexDirection="column" height="100%">
            <ChatPanel
                frozenMessages={frozenMessages}
                activeMessages={activeMessages}
                modelName={modelName}
                workspacePath={bootstrapConfig.workspacePath}
                positionalPromptWarning={positionalPromptWarning}
            />

            {isDriverViewActive && <DriverView selectedTab={selectedTab} />}

            {!nonInteractiveInput && (
                <>
                    <Box paddingY={1}>
                        {agentPermissionPrompt ? (
                            <AgentPermissionPromptComponent
                                prompt={agentPermissionPrompt}
                                onSubmit={handlePermissionPromptSubmit}
                                isFocused={focusedControl === 'permission'}
                            />
                        ) : (
                            <InputBar
                                value={inputValue}
                                onChange={setInputValue}
                                onSubmit={handleSubmit}
                                isFocused={focusedControl === 'input'}
                                onCommandMenuChange={setIsCommandMenuShown}
                                onEscStateChange={handleEscStateChange}
                                commands={inputCommands}
                            />
                        )}
                    </Box>
                    {activeTask && (
                        <TaskSpecificView
                            task={activeTask}
                            taskNumber={activeTaskNumber}
                            isFocused={focusedControl === 'task'}
                        />
                    )}
                    <TabView
                        staticOptions={staticTabs}
                        tasks={tasks}
                        selectedTab={selectedTab}
                        onTabChange={setSelectedTab}
                        isFocused={focusedControl === 'tabs'}
                    />
                    <Box paddingX={1} backgroundColor="gray">
                        <Text>
                            {isEscActive ? "[Press ESC again to clear input]" : "[Press Ctrl+N to switch view]"}
                        </Text>
                    </Box>
                </>
            )}
        </Box>
    );
};

// --- Render ---
const { stdin, stdout, stderr } = process;
if (stdin.isTTY && !stdin.isRaw) {
    stdin.setRawMode(true);
}
if (process.env.E2E_SENTINEL && stdout.isTTY && typeof (stdout as any).setNoDelay === 'function') {
    (stdout as any).setNoDelay(true);
}
render(<App />, { stdin, stdout, stderr, debug: false, exitOnCtrlC: true, patchConsole: false });

// --- Cleanup on exit ---
process.on('exit', closeTaskLogger);
process.on('SIGINT', () => { closeTaskLogger(); process.exit(0); });
process.on('SIGTERM', () => { closeTaskLogger(); process.exit(0); });
