
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { randomUUID } from 'crypto';
import { inspect } from 'util';
import { type PermissionUpdate, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import { addLog } from './src/logger.ts';
import { createBaseClaudeFlow } from './src/agent/flows/baseClaudeFlow.ts';
import { loadCliConfig } from './src/cli/config.ts';
import type { Task } from './task-manager.ts';
import { ensureAiProvider, type AiChatProvider } from './src/config/ai-provider.ts';
import * as Types from './src/types.ts';
import { ChatPanel } from './src/components/ChatPanel.tsx';
import { TabView } from './src/components/StatusControls.tsx';
import { TaskSpecificView } from './src/components/TaskSpecificView.tsx';
import { InputBar } from './src/components/InputBar.tsx';
import type { AgentPermissionPromptState, AgentPermissionOption } from './src/components/AgentPermissionPrompt.types.ts';
import { AgentPermissionPromptComponent } from './src/components/AgentPermissionPrompt.tsx';
import { useTaskStore } from './src/domain/taskStore.ts';
import { useConversationStore } from './src/domain/conversationStore.ts';
import { Driver, getDriverEnum, getDriverName } from './src/drivers/types.ts';
import {
    DRIVER_TABS,
    getDriverBySlash,
    getDriverByLabel,
    getDriverCommandEntries,
    type DriverManifestEntry,
} from './src/drivers/registry.ts';
import { closeTaskLogger } from './src/task-logger.ts';
import { loadWorkspaceSettings, writeWorkspaceSettings, type WorkspaceSettings } from './src/workspace/settings.ts';
// Guard to prevent double submission in dev double-mount scenarios
let __nonInteractiveSubmittedOnce = false;

const STATIC_TABS: readonly string[] = [
    Driver.CHAT,
    Driver.AGENT,
    ...DRIVER_TABS,
];

const BASE_COMMANDS: readonly { name: string; description: string }[] = [
    { name: 'task', description: 'Create a background task' },
    { name: 'newsession', description: 'Start a fresh Claude agent session' },
];

type AgentPromptJob = {
    rawInput: string;
    prompt: string;
    pendingMessageIds?: number[];
    systemPrompt?: string;
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
    const { tasks, createTask, waitTask } = useTaskStore();

    // 从 CLI 参数初始化 Driver（在 bootstrapConfig 确定后）
    useEffect(() => {
        if (bootstrapConfig?.driver) {
            const driverEnum = getDriverEnum(bootstrapConfig.driver);
            addLog(`[Driver Init] Setting driver from CLI: ${driverEnum}`);
            setSelectedTab(driverEnum);
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

    const prevTasksLengthRef = useRef(tasks.length);
    const agentWorkspaceStatusRef = useRef<{ missingNotified: boolean; errorNotified: boolean }>({
        missingNotified: false,
        errorNotified: false,
    });
    const lastAnnouncedAgentSessionRef = useRef<string | null>(null);
    const agentSessionInitializedRef = useRef<boolean>(false);
    const agentPendingQueueRef = useRef<AgentPromptJob[]>([]);
    const agentPermissionRequestsRef = useRef<Map<number, AgentPermissionRequest>>(new Map());
    const nextAgentPermissionIdRef = useRef<number>(1);
    const agentPermissionQueueRef = useRef<number[]>([]);
    const [agentPermissionPrompt, setAgentPermissionPrompt] = useState<AgentPermissionPromptState | null>(null);

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

        // 更新 placeholder 消息，显示权限详情和操作结果
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
                
                // 移除 isPending 属性，但不设置为 false，这样消息不会被 finalizeActiveMessages 移走
                const { isPending, ...msgWithoutPending } = msg;
                return {
                    ...msgWithoutPending,
                    content: resultContent,
                };
            }));

            // Finalize the permission message immediately after user action
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
        if (!commandRaw) {
            return null;
        }
        const command = commandRaw.toLowerCase();

        if (argTokens.length < 1) {
            appendSystemMessage(
                command === '/allow'
                    ? '[Agent] Usage: /allow <id> [always]'
                    : '[Agent] Usage: /deny <id> [reason]',
                true
            );
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
            let always = false;
            for (const token of restTokens) {
                const normalized = token.toLowerCase();
                if (normalized === 'always' || normalized === '--always') {
                    always = true;
                }
            }
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
            const hasSuggestions = Boolean(suggestions && suggestions.length > 0);

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

                // If the last message is an assistant placeholder, insert the permission message before it.
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
                let abortHandler: (() => void) | null = null;

                const finalize = (result: PermissionResult) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    if (abortHandler) {
                        signal.removeEventListener('abort', abortHandler);
                    }
                    agentPermissionRequestsRef.current.delete(requestId);
                    agentPermissionQueueRef.current = agentPermissionQueueRef.current.filter(id => id !== requestId);
                    resolve(result);
                    setAgentPermissionPrompt(prev => (prev && prev.requestId === requestId ? null : prev));
                    activateNextAgentPermissionPrompt();
                };

                const request: AgentPermissionRequest = {
                    id: requestId,
                    toolName,
                    input,
                    suggestions,
                    summary,
                    placeholderMessageId,
                    complete: finalize,
                    cancel: () =>
                        finalize({
                            behavior: 'deny',
                            message: 'Permission request cancelled.',
                            interrupt: false,
                        }),
                };

                abortHandler = () => {
                    if (!agentPermissionRequestsRef.current.has(requestId)) {
                        return;
                    }
                    setActiveMessages(prev => prev.filter(msg => msg.id !== placeholderMessageId));
                    appendSystemMessage(`[Agent] Permission request #${requestId} was cancelled by the agent.`, true);
                    addLog(`[Agent] Permission request #${requestId} cancelled by agent/runtime.`);
                    request.cancel();
                };

                agentPermissionRequestsRef.current.set(requestId, request);
                agentPermissionQueueRef.current.push(requestId);
                if (!agentPermissionPrompt) {
                    activateNextAgentPermissionPrompt();
                }

                if (signal.aborted) {
                    abortHandler();
                    return;
                }

                signal.addEventListener('abort', abortHandler, { once: true });
            });
        },
        [activateNextAgentPermissionPrompt, agentPermissionPrompt, finalizeActiveMessages, nextMessageId, appendSystemMessage, setActiveMessages]
    );

    const handlePermissionPromptSubmit = useCallback(
        (option: AgentPermissionOption) => {
            if (!agentPermissionPrompt) {
                return;
            }
            if (option === 'allow') {
                resolveAgentPermission(agentPermissionPrompt.requestId, { kind: 'allow' });
            } else if (option === 'always') {
                resolveAgentPermission(agentPermissionPrompt.requestId, { kind: 'allow', always: true });
            } else {
                resolveAgentPermission(agentPermissionPrompt.requestId, { kind: 'deny' });
            }
        },
        [agentPermissionPrompt, resolveAgentPermission]
    );

    const baseClaudeFlow = useMemo(
        () =>
            createBaseClaudeFlow({
                nextMessageId,
                setActiveMessages,
                finalizeMessageById,
                canUseTool: handleAgentPermissionRequest,
                workspacePath: bootstrapConfig?.workspacePath,
            }),
        [
            nextMessageId,
            setActiveMessages,
            finalizeMessageById,
            handleAgentPermissionRequest,
            bootstrapConfig?.workspacePath,
        ]
    );

    const agentFlowRegistry = useMemo(
        () => ({
            default: baseClaudeFlow,
        }),
        [baseClaudeFlow]
    );

    const driverCommandEntries = useMemo(() => getDriverCommandEntries(), []);
    const inputCommands = useMemo(
        () => [...BASE_COMMANDS, ...driverCommandEntries],
        [driverCommandEntries]
    );

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
            // A new task has been added
            const newTaskIndex = tasks.length - 1;
            setSelectedTab(`Task ${newTaskIndex + 1}`);
        }
        prevTasksLengthRef.current = tasks.length;
    }, [tasks]); // Dependency on tasks array

    useEffect(() => {
        if (selectedTab !== Driver.AGENT) {
            return;
        }

        if (agentSessionId) {
            return;
        }

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
                    const updatedSettings: WorkspaceSettings = {
                        sessions: [...settings.sessions, sessionId],
                    };
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

        return () => {
            cancelled = true;
        };
    }, [selectedTab, bootstrapConfig?.workspacePath, agentSessionId, appendSystemMessage]);

    useEffect(() => {
        if (selectedTab !== Driver.AGENT) {
            return;
        }
        if (!agentSessionId) {
            return;
        }
        if (lastAnnouncedAgentSessionRef.current === agentSessionId) {
            return;
        }
        const workspacePath = bootstrapConfig?.workspacePath ?? '(no workspace)';
        appendSystemMessage(
            `[Agent] Using Claude session ${formatSessionId(agentSessionId)} for workspace ${workspacePath}.`
        );
        lastAnnouncedAgentSessionRef.current = agentSessionId;
    }, [selectedTab, agentSessionId, bootstrapConfig?.workspacePath, appendSystemMessage]);

    useInput((input, key) => {
        // 当命令菜单显示时，不响应 Tab 键（让 InputBar 处理）
        if (agentPermissionPrompt) {
            return;
        }

        if (key.tab && isCommandMenuShown) {
            return;
        }

        if (key.tab) {
            const newFocusOrder: Array<typeof focusedControl> = ['input', 'tabs'];
            if (activeTask) {
                newFocusOrder.push('task');
            }
            const currentFocusIndex = newFocusOrder.indexOf(focusedControl);
            const nextFocusIndex = (currentFocusIndex + 1) % newFocusOrder.length;
            setFocusedControl(newFocusOrder[nextFocusIndex]!);
        }
    });

    // 顶层仅做记录：Ctrl+N 何时被捕获（不改变行为，便于与 InputBar 日志对照）
    useInput((input, key) => {
        if (key.ctrl && (input === 'n' || input === 'N')) {
            addLog(`[App] Ctrl+N detected (focusedControl=${focusedControl}, isCommandMenuShown=${isCommandMenuShown})`);
        }
    });

    const handleEscStateChange = useCallback((isEscActive: boolean) => {
        setIsEscActive(isEscActive);
    }, []);

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
            const updatedSettings: WorkspaceSettings = {
                sessions: [
                    ...settings.sessions.filter(session => typeof session === 'string' && session.trim().length > 0),
                    newSessionId,
                ],
            };
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

    const ensureAgentSession = useCallback(async (): Promise<string | null> => {
        if (agentSessionId) {
            return agentSessionId;
        }
        return await createNewAgentSession();
    }, [agentSessionId, createNewAgentSession]);

    const runDriverEntry = useCallback(
        async (entry: DriverManifestEntry, prompt: string): Promise<boolean> => {
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
                    markInitialized: () => {
                        agentSessionInitializedRef.current = true;
                    },
                };
            }

            // If this driver opts in to Agent pipeline, reuse Agent flow for identical UX
            if (entry.useAgentPipeline) {
                if (!agentSessionId) {
                    appendSystemMessage('[Agent] Session not ready yet. Switch to the Agent tab again to initialize.', true);
                    return false;
                }
                const systemPrompt = entry.systemPromptFactory ? entry.systemPromptFactory() : undefined;
                return await startAgentPrompt({ rawInput: prompt, prompt, systemPrompt });
            }

            const userMessage: Types.Message = {
                id: nextMessageId(),
                role: 'user',
                content: prompt,
            };

            try {
                addLog(`[Driver] Dispatching to ${entry.label}`);
                return await entry.handler(userMessage, {
                    nextMessageId,
                    setActiveMessages,
                    setFrozenMessages,
                    finalizeMessageById,
                    canUseTool: handleAgentPermissionRequest,
                    workspacePath: bootstrapConfig?.workspacePath,
                    createTask,
                    waitTask,
                    session: sessionContext,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                addLog(`[Driver] Error in ${entry.label}: ${message}`);
                appendSystemMessage(`[${entry.label}] Error: ${message}`, true);
                return false;
            }
        },
        [
            appendSystemMessage,
            bootstrapConfig?.workspacePath,
            createTask,
            ensureAgentSession,
            finalizeMessageById,
            handleAgentPermissionRequest,
            nextMessageId,
            setActiveMessages,
            setFrozenMessages,
            waitTask,
        ]
    );

    const startAgentPrompt = useCallback(async (job: AgentPromptJob): Promise<boolean> => {
        const { rawInput, prompt, pendingMessageIds, systemPrompt } = job;

        const userMessageId = nextMessageId();
        const userMessage: Types.Message = {
            id: userMessageId,
            role: 'user',
            content: rawInput,
        };

        setActiveMessages(prev => {
            const retainedPending = prev.filter(msg =>
                msg.isPending && !(pendingMessageIds?.includes(msg.id))
            );
            return [...retainedPending, userMessage];
        });

        // Finalize the user message so it's added to the history
        finalizeMessageById(userMessageId);

        setIsAgentStreaming(true);
        addLog(`[Agent] Sending prompt with session ${agentSessionId}: ${prompt.replace(/\s+/g, ' ').slice(0, 120)}`);

        try {
            const activeAgentFlow = agentFlowRegistry.default;

            await activeAgentFlow.handleUserInput({
                prompt,
                agentSessionId: agentSessionId!,
                sessionInitialized: agentSessionInitializedRef.current,
                systemPrompt,
            });

            agentSessionInitializedRef.current = true;
            return true;

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const details = formatErrorForDisplay(error);
            const combinedMessage = details ? `${message}\n${details}` : message;
            addLog(`[Agent] Error: ${combinedMessage}`);
            // Finalize the user message on error as well
            finalizeMessageById(userMessageId);
            appendSystemMessage(`[Agent] Error: ${combinedMessage}`, true);
            return false;
        } finally {
            setIsAgentStreaming(false);
            if (agentPendingQueueRef.current.length > 0) {
                const nextJob = agentPendingQueueRef.current.shift();
                if (nextJob) {
                    void startAgentPrompt(nextJob);
                }
            }
        }
    }, [
        agentSessionId,
        agentFlowRegistry,
        appendSystemMessage,
        nextMessageId,
        setActiveMessages,
        finalizeMessageById,
    ]);

    const runAgentTurn = useCallback(async (rawInput: string): Promise<boolean> => {
        const prompt = rawInput.trim();
        if (prompt.length === 0) {
            return false;
        }

        if (!agentSessionId) {
            appendSystemMessage('[Agent] Session not ready yet. Switch to the Agent tab again to initialize.', true);
            return false;
        }

        const isBusy = isAgentStreaming || agentPendingQueueRef.current.length > 0;

        if (isBusy) {
            const pendingUserMessageId = nextMessageId();
            const pendingAssistantMessageId = nextMessageId();

            const pendingUserMessage: Types.Message = {
                id: pendingUserMessageId,
                role: 'user',
                content: rawInput,
                isPending: true,
            };

            const pendingAssistantMessage: Types.Message = {
                id: pendingAssistantMessageId,
                role: 'assistant',
                content: '',
                reasoning: '',
                isPending: true,
            };

            setActiveMessages(prev => [...prev.filter(msg => msg.isPending), pendingUserMessage, pendingAssistantMessage]);

            agentPendingQueueRef.current.push({
                rawInput,
                prompt,
                pendingMessageIds: [pendingUserMessageId, pendingAssistantMessageId],
            });

            appendSystemMessage(
                `[Agent] Still processing previous request. Your message has been queued (${agentPendingQueueRef.current.length} pending).`
            );
            return true;
        }

        return await startAgentPrompt({ rawInput, prompt });
    }, [
        agentSessionId,
        appendSystemMessage,
        isAgentStreaming,
        nextMessageId,
        setActiveMessages,
        startAgentPrompt,
    ]);

    const handleSubmit = useCallback(async (userInput: string): Promise<boolean> => {
        addLog('--- New Submission ---');
        const trimmedInput = userInput.trim();
        if (trimmedInput.length === 0) return false;

        const permissionHandled = handleAgentPermissionCommand(trimmedInput);
        if (permissionHandled !== null) {
            if (permissionHandled) {
                setInputValue('');
            }
            return permissionHandled;
        }

        if (trimmedInput === '/newsession') {
            setInputValue('');
            if (selectedTab !== Driver.AGENT) {
                appendSystemMessage('The /newsession command is only available in the Agent tab.', true);
                return false;
            }
            return (await createNewAgentSession()) !== null;
        }

        const slashMatch = userInput.startsWith('/')
            ? /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(userInput)
            : null;

        if (slashMatch) {
            const command = slashMatch[1]?.toLowerCase() ?? '';
            const rest = slashMatch[2] ?? '';

            if (command === 'task') {
                const prompt = rest.length > 0 ? rest : '';
                if (!prompt) {
                    addLog('[Command] /task requires a prompt');
                    return false;
                }
                createTask(prompt);
                setInputValue('');
                return true;
            }

            const driverEntry = getDriverBySlash(command);
            if (driverEntry) {
                const prompt = rest.trim();
                if (!prompt) {
                    addLog(`[Command] /${command} requires a prompt`);
                    return false;
                }
                if (selectedTab !== driverEntry.label) {
                    addLog(`[Command] Switching to ${driverEntry.label} tab`);
                    setSelectedTab(driverEntry.label);
                }
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

        setInputValue('');

        if (selectedTab === Driver.PLAN_REVIEW_DO) {
            const newUserMessage: Types.Message = {
                id: nextMessageId(),
                role: 'user',
                content: userInput,
            };
            addLog('[Driver] Routing to Plan-Review-DO');
            return await handlePlanReviewDo(newUserMessage, {
                nextMessageId,
                setActiveMessages,
                setFrozenMessages,
                createTask,
                waitTask,
            });
        }

        if (selectedTab === Driver.AGENT) {
            return await runAgentTurn(userInput);
        }

        const newUserMessage: Types.Message = {
            id: nextMessageId(),
            role: 'user',
            content: userInput,
        };

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
    }, [
        appendSystemMessage,
        createNewAgentSession,
        createTask,
        flushPendingQueue,
        handleAgentPermissionCommand,
        isProcessingQueueRef,
        isStreaming,
        handleAgentPermissionCommand,
        nextMessageId,
        pendingUserInputsRef,
        runAgentTurn,
        runDriverEntry,
        runStreamForUserMessage,
        selectedTab,
        setInputValue,
        setSelectedTab,
    ]);

    useEffect(() => {
        if (!nonInteractiveInput || hasProcessedNonInteractiveRef.current || __nonInteractiveSubmittedOnce) {
            return;
        }

        // 如果 CLI 指定了 driver，则等待 selectedDriver 与之匹配后再提交
        const desired = bootstrapConfig?.driver ? getDriverEnum(bootstrapConfig.driver) : null;
        if (desired && selectedTab !== desired) {
            return; // 等待 driver 初始化完成
        }

        hasProcessedNonInteractiveRef.current = true;
        __nonInteractiveSubmittedOnce = true;
        addLog(`Non-interactive mode: Processing input "${nonInteractiveInput}"`);
        handleSubmit(nonInteractiveInput)
            .then(success => {
                setTimeout(() => {
                    process.exit(success ? 0 : 1);
                }, 100);
            })
            .catch(() => {
                setTimeout(() => {
                    process.exit(1);
                }, 100);
            });
    }, [handleSubmit, nonInteractiveInput, selectedTab, bootstrapConfig?.driver]);

    // --- RENDER ---
    const staticTabs = STATIC_TABS;
    const taskTabs = tasks.map((_: Task, index: number) => `Task ${index + 1}`);
    const allTabs = [...staticTabs, ...taskTabs];

    let activeTask: Task | null = null;
    let activeTaskNumber = 0;
    if (selectedTab.startsWith('Task ')) {
        const taskIndex = parseInt(selectedTab.replace('Task ', ''), 10) - 1;
        if (taskIndex >= 0 && taskIndex < tasks.length) {
            activeTask = tasks[taskIndex]!;
            activeTaskNumber = taskIndex + 1;
        }
    }

    return (
        <Box flexDirection="column" height="100%">
            <ChatPanel
                frozenMessages={frozenMessages}
                activeMessages={activeMessages}
                modelName={modelName}
                workspacePath={bootstrapConfig.workspacePath}
            />

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
};// --- Render ---
render(<App />);

// --- Cleanup on exit ---
process.on('exit', () => {
    closeTaskLogger();
});

process.on('SIGINT', () => {
    closeTaskLogger();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeTaskLogger();
    process.exit(0);
});
