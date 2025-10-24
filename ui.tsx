
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {render, Box, Text, useInput} from 'ink';

import { addLog } from './src/logger.ts';
import { loadCliConfig } from './src/cli/config.ts';
import type { Task } from './task-manager.ts';
import { ensureAiProvider, type AiChatProvider } from './src/config/ai-provider.ts';
import * as Types from './src/types.ts';
import { ChatPanel } from './src/components/ChatPanel.tsx';
import { BackgroundTasks } from './src/components/BackgroundTasks.tsx';
import { StatusControls } from './src/components/StatusControls.tsx';
import { InputBar } from './src/components/InputBar.tsx';
import { useTaskStore } from './src/domain/taskStore.ts';
import { useConversationStore } from './src/domain/conversationStore.ts';
import { Driver, getDriverEnum } from './src/drivers/types.ts';
import { handlePlanReviewDo } from './src/drivers/plan-review-do/index.ts';

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
    const [selectedDriver, setSelectedDriver] = useState<Driver>(Driver.MANUAL);
    const [focusedControl, setFocusedControl] = useState<'input' | 'kernel' | 'driver' | 'tasks'>('input');
    const { tasks, createTask } = useTaskStore();

    // 从 CLI 参数初始化 Driver（在 bootstrapConfig 确定后）
    useEffect(() => {
        if (bootstrapConfig?.driver) {
            const driverEnum = getDriverEnum(bootstrapConfig.driver);
            addLog(`[Driver Init] Setting driver from CLI: ${driverEnum}`);
            setSelectedDriver(driverEnum);
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
        if (key.tab) {
            if (focusedControl === 'input') setFocusedControl('kernel');
            else if (focusedControl === 'kernel') setFocusedControl('driver');
            else if (focusedControl === 'driver') setFocusedControl('tasks');
            else if (focusedControl === 'tasks') setFocusedControl('input');
        }
    });

    const handleSubmit = useCallback(async (userInput: string): Promise<boolean> => {
        addLog('--- New Submission ---');
        if (!userInput) return false;

        // /task 命令：创建后台任务（所有 Driver 共享）
        if (userInput.startsWith('/task ')) {
            const prompt = userInput.substring(6);
            createTask(prompt);
            setQuery('');
            return true;
        }

        const newUserMessage: Types.Message = {
            id: nextMessageId(),
            role: 'user',
            content: userInput,
        };

        setQuery('');

        // Driver 路由
        if (selectedDriver === Driver.PLAN_REVIEW_DO) {
            addLog('[Driver] Routing to Plan-Review-DO');
            return await handlePlanReviewDo(newUserMessage, {
                nextMessageId,
                setActiveMessages,
                setFrozenMessages,
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
        selectedDriver,
        createTask,
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
        if (!nonInteractiveInput || hasProcessedNonInteractiveRef.current) {
            return;
        }

        // 如果 CLI 指定了 driver，则等待 selectedDriver 与之匹配后再提交
        const desired = bootstrapConfig?.driver ? getDriverEnum(bootstrapConfig.driver) : null;
        if (desired && selectedDriver !== desired) {
            return; // 等待 driver 初始化完成
        }

        hasProcessedNonInteractiveRef.current = true;
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
    }, [handleSubmit, nonInteractiveInput, selectedDriver, bootstrapConfig?.driver]);

    // --- RENDER ---
    return (
        <Box flexDirection="column">
            <ChatPanel frozenMessages={frozenMessages} activeMessages={activeMessages} modelName={modelName} />

            <BackgroundTasks tasks={tasks} isFocused={focusedControl === 'tasks'} />

            {!nonInteractiveInput && (
                <>
                    <InputBar
                        value={query}
                        onChange={setQuery}
                        onSubmit={handleSubmit}
                        isFocused={focusedControl === 'input'}
                    />

                    <StatusControls
                        kernelOptions={Object.values(Kernel) as Kernel[]}
                        driverOptions={Object.values(Driver) as Driver[]}
                        selectedKernel={selectedKernel}
                        selectedDriver={selectedDriver}
                        onKernelChange={setSelectedKernel}
                        onDriverChange={setSelectedDriver}
                        isKernelFocused={focusedControl === 'kernel'}
                        isDriverFocused={focusedControl === 'driver'}
                    />
                </>
            )}
        </Box>
    );
};

// --- Render ---
render(<App />);
