
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {render, Box, Text, useInput} from 'ink';

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
// Guard to prevent double submission in dev double-mount scenarios
let __nonInteractiveSubmittedOnce = false;

enum Kernel {
  CLAUDE_CODE = 'Claude Code',
  GEMINI = 'Gemini',
  CODEX = 'Codex',
}


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
    const [query, setQuery] = useState('');
    const [selectedKernel, setSelectedKernel] = useState<Kernel>(Kernel.CLAUDE_CODE);
    const [selectedTab, setSelectedTab] = useState<string>(Driver.MANUAL);
    const [focusedControl, setFocusedControl] = useState<'input' | 'kernel' | 'tabs' | 'task'>('input');
    const [isCommandMenuShown, setIsCommandMenuShown] = useState(false);
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

    const handleSubmit = useCallback(async (userInput: string): Promise<boolean> => {
        addLog('--- New Submission ---');
        if (!userInput) return false;

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
            
            setQuery('');
            
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
            const newTask = createTask(prompt);
            setQuery('');
            // Find the index of the new task in the updated tasks array
            const newTabIndex = tasks.findIndex(task => task.id === newTask.id);
            if (newTabIndex !== -1) {
                setSelectedTab(`Task ${newTabIndex + 1}`);
            } else {
                // Fallback if for some reason the task isn't found immediately
                setSelectedTab(`Task ${tasks.length}`); // Assuming it's added at the end
            }
            return true;
        }

        const newUserMessage: Types.Message = {
            id: nextMessageId(),
            role: 'user',
            content: userInput,
        };

        setQuery('');

        // Driver 路由
        if (selectedTab === Driver.PLAN_REVIEW_DO) {
            addLog('[Driver] Routing to Plan-Review-DO');
            return await handlePlanReviewDo(newUserMessage, {
                nextMessageId,
                setActiveMessages,
                setFrozenMessages,
                createTask,
                waitTask,
            });
        }

        // Manual Driver（原有逻辑）
        addLog('[Driver] Using Manual mode');

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
        selectedTab,
        createTask,
        waitTask,
        flushPendingQueue,
        isProcessingQueueRef,
        isStreaming,
        nextMessageId,
        pendingUserInputsRef,
        runStreamForUserMessage,
        setActiveMessages,
        setFrozenMessages,
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
    const staticTabs = Object.values(Driver);
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
            <ChatPanel frozenMessages={frozenMessages} activeMessages={activeMessages} modelName={modelName} />

            {activeTask && (
                <TaskSpecificView 
                    task={activeTask} 
                    taskNumber={activeTaskNumber}
                    isFocused={focusedControl === 'task'} 
                />
            )}

            {!nonInteractiveInput && (
                <>
                    <InputBar
                        value={query}
                        onChange={setQuery}
                        onSubmit={handleSubmit}
                        isFocused={focusedControl === 'input'}
                        onCommandMenuChange={setIsCommandMenuShown}
                    />
                    <TabView
                        staticOptions={staticTabs}
                        tasks={tasks}
                        selectedTab={selectedTab}
                        onTabChange={setSelectedTab}
                        isFocused={focusedControl === 'tabs'}
                    />
                    <Box paddingX={1} backgroundColor="gray">
                        <Text color="gray">Press Ctrl+N to switch view</Text>
                    </Box>
                </>
            )}
        </Box>
    );
};

// --- Render ---
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
