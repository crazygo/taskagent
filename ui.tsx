
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {render, Box, Text, useInput} from 'ink';
import { randomUUID } from 'crypto';
import {inspect} from 'util';
import { query, type SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

import { addLog } from './src/logger.ts';
import { loadCliConfig } from './src/cli/config.ts';
import type { Task } from './task-manager.ts';
import { ensureAiProvider, type AiChatProvider } from './src/config/ai-provider.ts';
import * as Types from './src/types.ts';
import { ChatPanel } from './src/components/ChatPanel.js';
import { TabView } from './src/components/StatusControls.js';
import { TaskSpecificView } from './src/components/TaskSpecificView.js';
import { InputBar } from './src/components/InputBar.js';
import { useTaskStore } from './src/domain/taskStore.js';
import { useConversationStore } from './src/domain/conversationStore.js';
import { Driver, getDriverEnum, getDriverName } from './src/drivers/types.js';
import { handlePlanReviewDo } from './src/drivers/plan-review-do/index.js';
import { closeTaskLogger } from './src/task-logger.ts';
import { loadWorkspaceSettings, writeWorkspaceSettings, type WorkspaceSettings } from './src/workspace/settings.ts';
// Guard to prevent double submission in dev double-mount scenarios
let __nonInteractiveSubmittedOnce = false;

enum Kernel {
  CLAUDE_CODE = 'Claude Code',
  GEMINI = 'Gemini',
  CODEX = 'Codex',
}

const STATIC_TABS: readonly Driver[] = [
  Driver.CHAT,
  Driver.AGENT,
  Driver.PLAN_REVIEW_DO,
  Driver.STORY,
  Driver.UX,
  Driver.ARCHITECTURE,
  Driver.TECH_PLAN,
];

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
    const [selectedKernel, setSelectedKernel] = useState<Kernel>(Kernel.CLAUDE_CODE);
    const [selectedTab, setSelectedTab] = useState<string>(Driver.CHAT);
    const [focusedControl, setFocusedControl] = useState<'input' | 'kernel' | 'tabs' | 'task'>('input');
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

    const appendSystemMessage = useCallback((content: string, boxed = false) => {
        const systemMessage: Types.Message = {
            id: nextMessageId(),
            role: 'system',
            content,
            isBoxed: boxed,
        };
        setFrozenMessages(prev => [...prev, systemMessage]);
        setActiveMessages(prev => [...prev.filter(msg => msg.isPending), systemMessage]);
    }, [nextMessageId, setActiveMessages, setFrozenMessages]);

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

    const runAgentTurn = useCallback(async (rawInput: string): Promise<boolean> => {
        const prompt = rawInput.trim();
        if (prompt.length === 0) {
            return false;
        }

        if (!agentSessionId) {
            appendSystemMessage('[Agent] Session not ready yet. Switch to the Agent tab again to initialize.', true);
            return false;
        }

        if (isAgentStreaming) {
            appendSystemMessage('[Agent] Still processing previous request. Please wait.');
            return false;
        }

        const userMessage: Types.Message = {
            id: nextMessageId(),
            role: 'user',
            content: rawInput,
        };

        const assistantMessageId = nextMessageId();
        const assistantPlaceholder: Types.Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            reasoning: '',
        };

        setActiveMessages(prev => [...prev.filter(msg => msg.isPending), userMessage, assistantPlaceholder]);

        setIsAgentStreaming(true);
        addLog(`[Agent] Sending prompt with session ${agentSessionId}: ${prompt.replace(/\s+/g, ' ').slice(0, 120)}`);

        let assistantContent = '';
        let assistantReasoning = '';

        try {
            const options: any = {
                model: process.env.ANTHROPIC_MODEL,
                cwd: bootstrapConfig.workspacePath,
            };

            if (agentSessionInitializedRef.current) {
                options.resume = agentSessionId;
            } else {
                options.extraArgs = { 'session-id': agentSessionId };
            }

            const result = query({
                prompt,
                options,
            });

            const updateAssistant = () => {
                setActiveMessages(prev =>
                    prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content: assistantContent, reasoning: assistantReasoning }
                            : msg
                    )
                );
            };

            for await (const message of result) {
                if (message.type === 'assistant') {
                    const assistantMessage = message as SDKAssistantMessage;
                    for (const block of assistantMessage.message.content) {
                        if (block.type === 'text' && typeof block.text === 'string') {
                            assistantContent += block.text;
                            updateAssistant();
                        }
                        if (block.type === 'reasoning' && typeof block.text === 'string') {
                            assistantReasoning += block.text;
                            updateAssistant();
                        }
                    }
                }
            }

            const completedMessages: Types.Message[] = [
                userMessage,
                {
                    id: assistantMessageId,
                    role: 'assistant',
                    content: assistantContent,
                    reasoning: assistantReasoning,
                },
            ];

            setFrozenMessages(prev => [...prev, ...completedMessages]);
            addLog(`[Agent] Response completed (${assistantContent.length} chars).`);
            agentSessionInitializedRef.current = true;
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const details = formatErrorForDisplay(error);
            const combinedMessage = details ? `${message}\n${details}` : message;
            addLog(`[Agent] Error: ${combinedMessage}`);
            setFrozenMessages(prev => [...prev, userMessage]);
            appendSystemMessage(`[Agent] Error: ${combinedMessage}`, true);
            return false;
        } finally {
            setActiveMessages(prev => prev.filter(msg => msg.isPending));
            setIsAgentStreaming(false);
        }
    }, [
        agentSessionId,
        appendSystemMessage,
        isAgentStreaming,
        nextMessageId,
        setActiveMessages,
        setFrozenMessages,
    ]);

    const handleSubmit = useCallback(async (userInput: string): Promise<boolean> => {
        addLog('--- New Submission ---');
        const trimmedInput = userInput.trim();
        if (trimmedInput.length === 0) return false;

        if (trimmedInput === '/newsession') {
            setInputValue('');
            if (selectedTab !== Driver.AGENT) {
                appendSystemMessage('The /newsession command is only available in the Agent tab.', true);
                return false;
            }
            return (await createNewAgentSession()) !== null;
        }

        // /plan-review-do 命令：切换到 Plan-Review-DO driver 并执行
        if (userInput.startsWith('/plan-review-do ')) {
            const prompt = userInput.substring(16).trim();
            if (!prompt) {
                addLog('[Command] /plan-review-do requires a prompt');
                return false;
            }
            
            // 自动切换到 Plan-Review-DO driver
            if (selectedTab !== Driver.PLAN_REVIEW_DO) {
                addLog('[Command] Switching to Plan-Review-DO tab');
                setSelectedTab(Driver.PLAN_REVIEW_DO);
            }
            
            const newUserMessage: Types.Message = {
                id: nextMessageId(),
                role: 'user',
                content: prompt,
            };
            
            setInputValue('');
            
            addLog('[Command] Executing with Plan-Review-DO');
            return await handlePlanReviewDo(newUserMessage, {
                nextMessageId,
                setActiveMessages,
                setFrozenMessages,
                createTask,
                waitTask,
            });
        }

        // /task 命令：创建后台任务（所有 Driver 共享）
        if (userInput.startsWith('/task ')) {
            const prompt = userInput.substring(6);
            createTask(prompt);
            setQuery('');
            return true;
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

        const placeholderDrivers = [Driver.STORY, Driver.UX, Driver.ARCHITECTURE, Driver.TECH_PLAN];
        if (selectedTab === Driver.CHAT) {
            addLog('[Driver] Using Chat mode');
        } else if (placeholderDrivers.includes(selectedTab as Driver)) {
            addLog(`[Driver] Using ${selectedTab} mode (placeholder - fallback to Chat)`);
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
        isProcessingQueueRef,
        isStreaming,
        nextMessageId,
        pendingUserInputsRef,
        runAgentTurn,
        runStreamForUserMessage,
        selectedTab,
        setActiveMessages,
        setFrozenMessages,
        waitTask,
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
                        <InputBar
                        value={inputValue}
                        onChange={setInputValue}
                            onSubmit={handleSubmit}
                            isFocused={focusedControl === 'input'}
                            onCommandMenuChange={setIsCommandMenuShown}
                            onEscStateChange={handleEscStateChange}
                        />
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
