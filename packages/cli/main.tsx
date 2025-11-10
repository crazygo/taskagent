#!/usr/bin/env node

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { randomUUID } from 'crypto';
import { inspect } from 'util';
import { type AgentDefinition, type PermissionUpdate, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import { addLog } from '@taskagent/shared/logger';
import { loadCliConfig } from './cli/config.js';
import type { Task } from '@taskagent/shared/task-manager';
import { ensureAiProvider, type AiChatProvider } from './config/ai-provider.js';
import * as Types from './types.js';
import { ChatPanel } from './components/ChatPanel.js';
import { TabView } from './components/StatusControls.js';
import { TaskSpecificView } from './components/TaskSpecificView.js';
import { InputBar } from './components/InputBar.js';
import type { AgentPermissionPromptState, AgentPermissionOption } from './components/AgentPermissionPrompt.types.js';
import { AgentPermissionPromptComponent } from './components/AgentPermissionPrompt.js';
import { useTaskStore } from './domain/taskStore.js';
import { useConversationStore } from './domain/conversationStore.js';
import {
    Driver,
    type AgentPipelineInvocationOptions,
    type DriverManifestEntry,
    type ViewDriverEntry,
    type BackgroundTaskDriverEntry,
    type DriverRuntimeContext,
} from './drivers/types.js';
import {
    DRIVER_TABS,
    getDriverBySlash,
    getDriverByLabel,
    getDriverByCliName,
    getDriverCommandEntries,
} from './drivers/registry.js';
import type { AgentPipelineOverrides } from './drivers/pipeline.js';
import { closeTaskLogger } from '@taskagent/shared/task-logger';
import { loadWorkspaceSettings, writeWorkspaceSettings, type WorkspaceSettings } from './workspace/settings.js';
import { getGlobalTabRegistry, type TabConfig } from '@taskagent/tabs';
import { chatTabConfig } from '@taskagent/tabs/configs/chat';
import { agentTabConfig } from '@taskagent/tabs/configs/agent';
import { storyTabConfig } from '@taskagent/tabs/configs/story';
import { glossaryTabConfig } from '@taskagent/tabs/configs/glossary';
import { uiReviewTabConfig } from '@taskagent/tabs/configs/ui-review';
import { monitorTabConfig } from '@taskagent/tabs/configs/monitor';
import { looperTabConfig } from '@taskagent/tabs/configs/looper';
import { getPresetOrDefault } from '@taskagent/presets';
import { globalAgentRegistry, registerAllAgents } from '@taskagent/agents/registry';
import type { AgentStartContext, AgentStartSinks } from '@taskagent/agents/runtime/types.js';
import { EventBus } from '@taskagent/core/event-bus';
import { MessageStore } from './store/MessageStore.js';
import { useMessageStoreTab } from './hooks/useMessageStoreTab.js';
import { useAgentEventBridge } from './hooks/useAgentEventBridge.js';
import { TabExecutionManager, TabExecutor } from '@taskagent/execution';
import type { ExecutionContext, ExecutionResult } from '@taskagent/execution';

// Guard to prevent double submission in dev double-mount scenarios
let __nonInteractiveSubmittedOnce = false;

// Initialize TabRegistry - tabs will be registered based on preset in App component
const tabRegistry = getGlobalTabRegistry();

// Initialize Agent Registry - register all built-in agents
registerAllAgents();

// STATIC_TABS will be populated dynamically after tabs are registered
function getStaticTabs(): string[] {
    const allTabs = tabRegistry.getAll();
    
    // If tabs are registered, use them directly (respects preset)
    if (allTabs.length > 0) {
        return [
            ...allTabs.map(tab => tab.label),
            ...DRIVER_TABS, // Keep for backward compatibility (empty now)
        ];
    }
    
    // Fallback for when no tabs registered yet
    return [Driver.CHAT, Driver.AGENT];
}

const BASE_COMMANDS: readonly { name: string; description: string }[] = [
    { name: 'newsession', description: 'Start a fresh Claude agent session' },
];

/**
 * Get tab information by label - bridges TabRegistry and old Driver system
 * @param label Tab label (e.g., 'Story', 'Glossary')
 * @returns Tab config with requiresSession and description
 */
function getTabInfoByLabel(label: string): { requiresSession: boolean; description: string; label: string } | null {
    const tabConfig = tabRegistry.get(label) ?? tabRegistry.getByLabel(label);
    if (tabConfig) {
        return {
            requiresSession: tabConfig.requiresSession,
            description: tabConfig.description,
            label: tabConfig.label,
        };
    }
    
    // Fallback to old Driver system
    const driverEntry = getDriverByLabel(label);
    if (driverEntry) {
        return {
            requiresSession: driverEntry.requiresSession,
            description: driverEntry.description,
            label: driverEntry.label,
        };
    }
    
    return null;
}

/**
 * Get tab by CLI name - bridges TabRegistry and old Driver system
 * @param cliName CLI name (e.g., 'story', 'glossary')
 * @returns Tab info with label
 */
function getTabByCliName(cliName: string): { label: string } | null {
    const normalizedCliName = cliName.replace(/^--/, '').trim().toLowerCase();

    // Try matching CLI flag (e.g., '--blueprint')
    const flagMatch = tabRegistry.getByCliFlag(`--${normalizedCliName}`);
    if (flagMatch) {
        return { label: flagMatch.label };
    }

    // Try direct ID or label (case-insensitive, slug-aware)
    const idMatch = tabRegistry.get(cliName) ?? tabRegistry.get(normalizedCliName);
    if (idMatch) {
        return { label: idMatch.label };
    }

    const labelMatch = tabRegistry.getByLabel(cliName) ?? tabRegistry.getByLabel(normalizedCliName);
    if (labelMatch) {
        return { label: labelMatch.label };
    }

    // Fallback to old Driver system
    const driverEntry = getDriverByCliName(normalizedCliName);
    if (driverEntry) {
        return { label: driverEntry.label };
    }

    return null;
}

type AgentTurnOverrides = AgentPipelineOverrides;

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

    // Register tabs based on preset and set default tab (runs once)
    const [tabsInitialized, setTabsInitialized] = useState(false);
    
    useEffect(() => {
        if (tabsInitialized) {
            return; // Already initialized
        }
        
        const presetName = bootstrapConfig.preset || 'default';
        addLog(`[Preset] Initializing with preset: ${presetName}`);
        
        try {
            // Check if tabs already registered (e.g., in test environment)
            const existingTabs = tabRegistry.getAll();
            if (existingTabs.length > 0) {
                addLog(`[Preset] Using ${existingTabs.length} already registered tabs`);
                setTabsInitialized(true);
                return;
            }

            // Load preset configuration from @taskagent/presets
            const presetConfig = getPresetOrDefault(presetName);
            addLog(`[Preset] Loaded preset '${presetConfig.name}' with ${presetConfig.tabs.length} tabs`);

            // Map tab IDs to tab configs
            const tabConfigMap: Record<string, TabConfig> = {
                'Chat': chatTabConfig,
                'Agent': agentTabConfig,
                'Story': storyTabConfig,
                'Glossary': glossaryTabConfig,
                'UI-Review': uiReviewTabConfig,
                'DevHub': monitorTabConfig,
                'Looper': looperTabConfig,
            };

            // Register tabs based on preset
            const tabsToRegister = presetConfig.tabs
                .map(tabId => tabConfigMap[tabId])
                .filter((config): config is TabConfig => config !== undefined);

            if (tabsToRegister.length === 0) {
                addLog(`[Preset] Warning: No valid tabs found for preset '${presetName}', falling back to default`);
                // Fallback to all tabs
                tabRegistry.registerMany([
                    chatTabConfig,
                    agentTabConfig,
                    storyTabConfig,
                    glossaryTabConfig,
                    uiReviewTabConfig,
                    monitorTabConfig,
                    looperTabConfig
                ]);
            } else {
                tabRegistry.registerMany(tabsToRegister);
                addLog(`[Preset] Registered ${tabsToRegister.length} tabs: ${tabsToRegister.map(t => t.label).join(', ')}`);
            }

            // Set default tab based on preset
            if (presetConfig.defaultTab && tabConfigMap[presetConfig.defaultTab]) {
                setSelectedTab(presetConfig.defaultTab);
                addLog(`[Preset] Default tab set to: ${presetConfig.defaultTab}`);
            }
            
            setTabsInitialized(true);
        } catch (error) {
            if (error instanceof Error && error.message.includes('already registered')) {
                addLog('[Preset] Tabs already registered (test environment)');
                setTabsInitialized(true);
            } else {
                throw error;
            }
        }
    }, [bootstrapConfig.preset, tabsInitialized]);

    const nonInteractiveInput = bootstrapConfig.prompt;
    const autoAllowPermissions = bootstrapConfig.autoAllowPermissions;
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
    const eventBus = useMemo(() => new EventBus(), []);
    const messageStore = useMemo(() => new MessageStore({ eventBus }), [eventBus]);
    const tabExecManager = useMemo(() => new TabExecutionManager(), []);
    const tabExecutor = useMemo(() => new TabExecutor(tabExecManager, globalAgentRegistry, eventBus), [tabExecManager, eventBus]);
    const { registerConversation } = useAgentEventBridge(eventBus, messageStore);
    const [inputValue, setInputValue] = useState('');
    const [selectedTab, setSelectedTab] = useState<string>(Driver.CHAT);
    const { frozen: frozenMessages, active: activeMessages } = useMessageStoreTab(messageStore, selectedTab);
    const [focusedControl, setFocusedControl] = useState<'input' | 'tabs' | 'task' | 'permission'>('input');
    const [isCommandMenuShown, setIsCommandMenuShown] = useState(false);
    const [isEscActive, setIsEscActive] = useState(false);
    const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
    const [, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
    const { tasks, startBackground, waitTask, cancelTask } = useTaskStore();
    
    // Re-register agents with runtime dependencies (after hooks are initialized)
    // Use a ref to track if already registered to prevent infinite loop
    const agentsRegisteredRef = useRef(false);
    useEffect(() => {
        if (agentsRegisteredRef.current) {
            return; // Already registered, skip
        }
        
        const taskManager = { 
            startBackground, 
            waitTask,
            cancelTask 
        };
        registerAllAgents({ 
            eventBus, 
            tabExecutor, 
            taskManager,
            messageStore
        });
        addLog('[AgentRegistry] Re-registered agents with runtime dependencies');
        agentsRegisteredRef.current = true;
    }, [eventBus, tabExecutor]); // Remove startBackground, waitTask, cancelTask from dependencies
    const [positionalPromptWarning, setPositionalPromptWarning] = useState<string | null>(null);

    const automationRanRef = useRef(false);
    const handleSubmitRef = useRef<((input: string) => Promise<boolean>) | null>(null);
    const tasksRef = useRef(tasks);
    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        if (bootstrapConfig?.driver) {
            const tab = getTabByCliName(bootstrapConfig.driver);
            if (tab) {
                addLog(`[Driver Init] Setting tab from CLI: ${tab.label}`);
                setSelectedTab(tab.label);
            }
        }
    }, [bootstrapConfig?.driver]);

    // --- REFS ---
    const hasProcessedNonInteractiveRef = useRef(false);
    const selectedTabRef = useRef(selectedTab);
    const {
        isStreaming,
        runStreamForUserMessage,
        enqueueUserInput,
        isProcessingQueueRef,
        flushPendingQueue,
        nextMessageId,
    } = useConversationStore({
        aiProvider: provider,
        modelName,
        reasoningEnabled: reasoningEnabled || false,
        messageStore,
        getActiveTabId: () => selectedTabRef.current,
    });
    useEffect(() => {
        selectedTabRef.current = selectedTab;
        messageStore.setCurrentTab(selectedTab);
    }, [selectedTab]);

    const isStreamingRef = useRef(isStreaming);
    useEffect(() => {
        isStreamingRef.current = isStreaming;
    }, [isStreaming]);

    const agentWorkspaceStatusRef = useRef<{ missingNotified: boolean; errorNotified: boolean }>({
        missingNotified: false,
        errorNotified: false,
    });
    const lastAnnouncedAgentSessionRef = useRef<string | null>(null);
    const forcedSessionPromiseRef = useRef<Promise<string | null> | null>(null);
    const shouldForceNewSessionRef = useRef<boolean>(bootstrapConfig?.newSession ?? false);
    const bootstrapNewSessionAppliedRef = useRef<boolean>(false);
    const agentPermissionRequestsRef = useRef<Map<number, AgentPermissionRequest>>(new Map());
    const nextAgentPermissionIdRef = useRef<number>(1);
const agentPermissionQueueRef = useRef<number[]>([]);
const [agentPermissionPrompt, setAgentPermissionPrompt] = useState<AgentPermissionPromptState | null>(null);
const lastAnnouncedDriverRef = useRef<string | null>(null);

    const finalizeMessageById = useCallback((messageId: number) => {
        const tabId = selectedTabRef.current;
        messageStore.mutateMessage(tabId, messageId, msg => ({
            ...msg,
            isPending: false,
            queueState: msg.queueState === 'active' ? 'completed' : msg.queueState,
        }));
    }, [messageStore]);

    const appendSystemMessage = useCallback((content: string, boxed = false) => {
        const tabId = selectedTabRef.current;
        const systemMessage: Types.Message = {
            id: nextMessageId(),
            role: 'system',
            content,
            isBoxed: boxed,
        };
        messageStore.appendMessage(tabId, systemMessage);
    }, [messageStore, nextMessageId]);

    useEffect(() => {
        const staticTabs = getStaticTabs();
        if (!staticTabs.includes(selectedTab) || selectedTab === Driver.CHAT || selectedTab === Driver.AGENT) {
            lastAnnouncedDriverRef.current = null;
            return;
        }

        const tabInfo = getTabInfoByLabel(selectedTab);
        if (!tabInfo) {
            lastAnnouncedDriverRef.current = null;
            return;
        }

        if (lastAnnouncedDriverRef.current !== tabInfo.label) {
            appendSystemMessage(`[${tabInfo.label}] view is active.`);
            lastAnnouncedDriverRef.current = tabInfo.label;
        }
    }, [appendSystemMessage, selectedTab]);

    const waitForStreamsToIdle = useCallback(async ({
        timeoutMs,
        isCancelled,
        context = 'Streams',
    }: {
        timeoutMs?: number;
        isCancelled?: () => boolean;
        context?: string;
    } = {}): Promise<boolean> => {
        const limit = timeoutMs ?? 30000;
        const start = Date.now();
        const sleep = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));
        while (!isCancelled?.()) {
            const conversationIdle = !isStreamingRef.current && !isProcessingQueueRef.current;
            const currentTabId = selectedTabRef.current;
            const agentIdle = tabExecutor.isIdle(currentTabId) && tabExecManager.getQueueLength(currentTabId) === 0;
            if (conversationIdle && agentIdle) {
                return true;
            }
            if (Date.now() - start > limit) {
                addLog(`[${context}] waitForStreamsToIdle timed out after ${limit}ms`);
                return false;
            }
            await sleep(100);
        }
        return false;
    }, [addLog, tabExecManager]);

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
            const timestamp = new Date().toISOString();
            addLog(`[Permission] ${timestamp} - Updating placeholder #${request.placeholderMessageId} for request #${id}, decision=${decision.kind}`);

            messageStore.mutateMessage(selectedTabRef.current, request.placeholderMessageId, msg => {
                let resultContent: string;
                if (decision.kind === 'allow') {
                    const rememberNote = decision.always && hasSuggestions ? ' (remembered for this session)' : '';
                    resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n✓ Approved${rememberNote}`;
                } else {
                    const reason = decision.reason?.trim().length ? decision.reason.trim() : 'Denied by user';
                    resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n✗ Denied: ${reason}`;
                }

                return {
                    ...msg,
                    content: resultContent,
                    isPending: false,
                };
            });

            addLog(`[Permission] ${timestamp} - Calling finalizeMessageById for placeholder #${request.placeholderMessageId}`);
            finalizeMessageById(request.placeholderMessageId);
            addLog(`[Permission] ${timestamp} - Finalized placeholder #${request.placeholderMessageId}`);
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
    }, [appendSystemMessage, finalizeMessageById, messageStore]);

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
            const timestamp = new Date().toISOString();
            addLog(`[Permission] ${timestamp} - Creating placeholder #${placeholderMessageId} for request #${requestId}, tool=${toolName}`);
            
            const placeholderMessage: Types.Message = {
                id: placeholderMessageId,
                role: 'system',
                content: `[Agent] Waiting for permission #${requestId} on "${toolName}"…`,
                isPending: true,
            };
            messageStore.appendMessage(selectedTabRef.current, placeholderMessage);

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
                    messageStore.removeMessage(selectedTabRef.current, placeholderMessageId);
                    appendSystemMessage(`[Agent] Permission request #${requestId} was cancelled by the agent.`, true);
                    addLog(`[Agent] Permission request #${requestId} cancelled by agent/runtime.`);
                    finalize({ behavior: 'deny', message: 'Permission request cancelled.', interrupt: false });
                };

                agentPermissionRequestsRef.current.set(requestId, {
                    id: requestId, toolName, input, suggestions, summary, placeholderMessageId,
                    complete: finalize,
                    cancel: () => finalize({ behavior: 'deny', message: 'Permission request cancelled.', interrupt: false }),
                });

                if (autoAllowPermissions) {
                    addLog(`[Agent] Auto-approving permission #${requestId} for "${toolName}" (--auto-allow).`);
                    resolveAgentPermission(requestId, { kind: 'allow', always: true });
                    return;
                }

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
        [activateNextAgentPermissionPrompt, agentPermissionPrompt, nextMessageId, appendSystemMessage, autoAllowPermissions, resolveAgentPermission, messageStore]
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
        const tabInfo = getTabInfoByLabel(selectedTab);
        const needsSession = selectedTab === Driver.AGENT || (tabInfo?.requiresSession ?? false);

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
                }
                if (cancelled) return;
                setAgentSessionId(sessionId);
                lastAnnouncedAgentSessionRef.current = null;
                agentWorkspaceStatusRef.current.errorNotified = false;
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
    addLog(`[Agent] Using Claude session ${formatSessionId(agentSessionId)} for workspace ${workspacePath}.`);
    lastAnnouncedAgentSessionRef.current = agentSessionId;
}, [selectedTab, agentSessionId, bootstrapConfig?.workspacePath]);

    const InputHandlers = React.memo(() => {
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

        return null;
    });



    const handleEscStateChange = useCallback((isEscActive: boolean) => setIsEscActive(isEscActive), []);

    const createNewAgentSession = useCallback(async (): Promise<string | null> => {
        const workspacePath = bootstrapConfig?.workspacePath;
        if (!workspacePath) {
            appendSystemMessage('[Agent] Cannot create a new session without --workspace.', true);
            return null;
        }
        const currentTabId = selectedTabRef.current;
        if (!tabExecutor.isIdle(currentTabId) || tabExecManager.getQueueLength(currentTabId) > 0) {
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
            tabExecManager.setSession(currentTabId, { id: newSessionId, initialized: false });
            appendSystemMessage(`[Agent] Started new Claude session ${formatSessionId(newSessionId)}.`);
            addLog(`[Agent] Created new session ${newSessionId} for workspace ${workspacePath}`);
            return newSessionId;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendSystemMessage(`[Agent] Failed to create new session: ${message}`, true);
            addLog(`[Agent] Failed to create new session: ${message}`);
            return null;
        }
    }, [bootstrapConfig?.workspacePath, appendSystemMessage, tabExecutor, tabExecManager]);

    useEffect(() => {
        if (!bootstrapConfig?.newSession || bootstrapNewSessionAppliedRef.current) return;
        bootstrapNewSessionAppliedRef.current = true;
        shouldForceNewSessionRef.current = true;
    }, [bootstrapConfig?.newSession]);

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

    const runAgentTurn = useCallback(async (rawInput: string, overrides?: AgentTurnOverrides, sessionIdHint?: string, _flowId?: string, agentIdOverride?: string, tabOverride?: string): Promise<boolean> => {
        const prompt = rawInput.trim();
        if (prompt.length === 0) return false;

        const tabId = tabOverride ?? selectedTabRef.current;
        let targetAgentId = agentIdOverride;
        if (!targetAgentId) {
            const tabConfig = tabRegistry.get(tabId) ?? tabRegistry.getByLabel(tabId);
            targetAgentId = tabConfig?.agentId ?? 'default';
        }

        if (!targetAgentId || !globalAgentRegistry.has(targetAgentId)) {
            appendSystemMessage(`[Agent] Agent '${targetAgentId ?? 'unknown'}' not found in registry. Available agents: ${globalAgentRegistry.getAllIds().join(', ')}`, true);
            return false;
        }

        let sessionIdToUse = sessionIdHint ?? agentSessionId ?? null;
        if (shouldForceNewSessionRef.current || !sessionIdToUse) {
            shouldForceNewSessionRef.current = false;
            const fresh = await createNewAgentSession();
            if (!fresh) {
                appendSystemMessage('[Agent] Session not ready yet. Switch to the Agent tab again to initialize.', true);
                return false;
            }
            sessionIdToUse = fresh;
        } else {
            const currentTabId = selectedTabRef.current;
            const existing = tabExecManager.getSession(currentTabId);
            if (!existing || existing.id !== sessionIdToUse) {
                tabExecManager.setSession(currentTabId, { id: sessionIdToUse, initialized: true });
            }
        }

        const activeSessionId = sessionIdToUse;

        const userMessageId = messageStore.getNextMessageId();
        const userMessage: Types.Message = {
            id: userMessageId,
            role: 'user',
            content: rawInput,
            timestamp: Date.now(),
            queueState: 'active',
        };
        messageStore.appendMessage(tabId, userMessage);

        const assistantMessageId = messageStore.getNextMessageId();
        const assistantPlaceholder: Types.Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            reasoning: '',
            isPending: true,
            queueState: 'active',
            timestamp: Date.now(),
        };
        messageStore.appendMessage(tabId, assistantPlaceholder);

        const queueIndex = registerConversation(tabId, userMessageId, assistantMessageId);
        if (queueIndex > 0) {
            messageStore.mutateMessage(tabId, userMessageId, msg => ({ ...msg, queueState: 'queued' }));
        }

        try {
            let sessionState = tabExecManager.getSession(tabId);
            if (!sessionState || sessionState.id !== activeSessionId) {
                sessionState = { id: activeSessionId, initialized: sessionState?.initialized ?? false };
                tabExecManager.setSession(tabId, sessionState);
            }

            const executeOnce = async (overrideSessionId?: string): Promise<ExecutionResult> => {
                const sessionForRun = overrideSessionId
                    ? { id: overrideSessionId, initialized: false }
                    : { ...sessionState };

                const context: ExecutionContext = {
                    sourceTabId: tabId,
                    workspacePath: bootstrapConfig?.workspacePath,
                    session: sessionForRun,
                    // Forward the SDK-compatible handler so tool requests receive proper PermissionResult payloads (per https://docs.claude.com/en/api/agent-sdk/typescript.md).
                    canUseTool: handleAgentPermissionRequest,
                };

                return await tabExecutor.execute(tabId, targetAgentId, prompt, context);
            };

            let result = await executeOnce();

            if (result.sessionId) {
                tabExecManager.setSession(tabId, { id: result.sessionId, initialized: true });
                if (tabId === Driver.AGENT) {
                    setAgentSessionId(result.sessionId);
                }
            } else {
                tabExecManager.setSession(tabId, { id: activeSessionId, initialized: result.success });
            }

            if (!result.success && result.error) {
                const shouldRetrySession = result.error.toLowerCase().includes('claude code process exited with code 1');
                if (shouldRetrySession) {
                    shouldForceNewSessionRef.current = true;
                    if (tabId === Driver.AGENT) {
                        setAgentSessionId(null);
                        lastAnnouncedAgentSessionRef.current = null;
                    }
                }

                if (shouldRetrySession) {
                    appendSystemMessage('[Agent] Claude Code crashed; the next prompt will start a fresh session.', true);
                } else {
                    appendSystemMessage(`[Agent] Error: ${result.error}`, true);
                }
            }

            return result.success;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendSystemMessage(`[Agent] Error: ${message}`, true);
            messageStore.mutateMessage(tabId, assistantMessageId, msg => ({
                ...msg,
                isPending: false,
                queueState: 'completed',
            }));
            return false;
        } finally {
            messageStore.mutateMessage(tabId, userMessageId, msg => ({
                ...msg,
                queueState: 'completed',
            }));
        }
    }, [agentSessionId, appendSystemMessage, bootstrapConfig?.workspacePath, handleAgentPermissionRequest, messageStore, registerConversation, tabExecutor, tabExecManager]);

    const runDriverEntry = useCallback(async (entry: DriverManifestEntry, prompt: string): Promise<boolean> => {
        let sessionContext = undefined as { id: string; initialized: boolean; markInitialized: () => void } | undefined;
        if (entry.requiresSession) {
            const sessionId = await ensureAgentSession();
            if (!sessionId) {
                appendSystemMessage(`[${entry.label}] Failed to initialize Claude session.`, true);
                addLog(`[Driver] Failed to ensure Claude session for ${entry.label}`);
                return false;
            }
            const currentTabId = selectedTab;
            const existingSession = tabExecManager.getSession(currentTabId);
            if (!existingSession || existingSession.id !== sessionId) {
                tabExecManager.setSession(currentTabId, { id: sessionId, initialized: existingSession?.initialized ?? false });
            }
            const resolvedSession = tabExecManager.getSession(currentTabId) ?? { id: sessionId, initialized: false };
            sessionContext = {
                id: resolvedSession.id,
                initialized: resolvedSession.initialized,
                markInitialized: () => { tabExecManager.setSession(currentTabId, { id: sessionId, initialized: true }); },
            };
        }

        const runAgentPipelineViaExecutor = async (agentId: string, driverPrompt: string, options?: AgentPipelineInvocationOptions) => {
            const targetTabId = options?.tabId ?? selectedTab;
            const targetSession = options?.session ?? sessionContext;
            const flowId = options?.flowId;
            const overrides = options?.overrides;
            const success = await runAgentTurn(driverPrompt, overrides, targetSession?.id, flowId, agentId, targetTabId);
            if (success && targetSession) {
                targetSession.markInitialized();
            }
            return success;
        };

        const scheduleAgentPipelineViaExecutor = (agentId: string, driverPrompt: string, options?: AgentPipelineInvocationOptions) => {
            const targetTabId = options?.tabId ?? selectedTab;
            const targetSession = options?.session ?? sessionContext;
            const flowId = options?.flowId;
            const overrides = options?.overrides;
            void runAgentTurn(driverPrompt, overrides, targetSession?.id, flowId, agentId, targetTabId)
                .then(success => {
                    if (success && targetSession) {
                        targetSession.markInitialized();
                    }
                })
                .catch(error => {
                    const message = error instanceof Error ? error.message : String(error);
                    addLog(`[Driver] Background agent ${agentId} failed: ${message}`);
                });
        };

        const runtimeContext: Omit<DriverRuntimeContext, 'session'> & { session?: typeof sessionContext } = {
            nextMessageId,
            messageStore,
            finalizeMessageById,
            canUseTool: handleAgentPermissionRequest,
            workspacePath: bootstrapConfig?.workspacePath,
            sourceTabId: selectedTab,
            startBackground: (agent, userPrompt, ctx) => startBackground(agent, userPrompt, ctx),
            waitTask,
            session: sessionContext,
            runAgentPipeline: runAgentPipelineViaExecutor,
            scheduleAgentPipeline: scheduleAgentPipelineViaExecutor,
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
    }, [addLog, agentSessionId, appendSystemMessage, bootstrapConfig?.workspacePath, ensureAgentSession, finalizeMessageById, handleAgentPermissionRequest, runAgentTurn, nextMessageId, startBackground, waitTask, selectedTab, messageStore, tabExecManager]);

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
        
        // Check TabRegistry first for agent tabs
        const tabConfig = tabRegistry.get(selectedTab) ?? tabRegistry.getByLabel(selectedTab);
        if (tabConfig && tabConfig.type === 'agent' && !tabConfig.isPlaceholder) {
            // Agent tab - use agent pipeline
            addLog(`[Tab] Routing to agent tab: ${tabConfig.label} (agentId: ${tabConfig.agentId})`);
            return await runAgentTurn(userInput);
        }
        
        // Check old Driver registry for backward compatibility
        const activeDriver = getDriverByLabel(selectedTab);
        if (activeDriver) {
            addLog(`[Driver] Routing to ${activeDriver.label}`);
            return await runDriverEntry(activeDriver, userInput);
        }

        // Fallback to Chat
        const messageId = nextMessageId();
        const baseTimestamp = Date.now();
        const newUserMessage: Types.Message = { id: messageId, role: 'user', content: userInput, timestamp: baseTimestamp };
        if (selectedTab === Driver.CHAT) {
            addLog('[Driver] Using Chat mode');
        } else {
            addLog(`[Driver] Using ${selectedTab} mode (fallback to Chat)`);
        }

        if (isStreaming || isProcessingQueueRef.current) {
            addLog(`Stream in progress. Queuing user input: ${userInput}`);
            const tabId = selectedTab;
            const userPlaceholder: Types.Message = {
                ...newUserMessage,
                isPending: true,
                queueState: 'queued',
            };
            messageStore.appendMessage(tabId, userPlaceholder);

            const assistantPlaceholderId = messageStore.getNextMessageId();
            messageStore.appendMessage(tabId, {
                id: assistantPlaceholderId,
                role: 'assistant',
                content: '',
                reasoning: '',
                isPending: true,
                queueState: 'queued',
                timestamp: baseTimestamp,
            });

            enqueueUserInput({
                tabId,
                message: newUserMessage,
                userPlaceholderId: messageId,
                assistantPlaceholderId,
            });
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
    }, [appendSystemMessage, createNewAgentSession, enqueueUserInput, flushPendingQueue, handleAgentPermissionCommand, isProcessingQueueRef, isStreaming, messageStore, nextMessageId, runAgentTurn, runDriverEntry, runStreamForUserMessage, selectedTab, setInputValue]);

    useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);

    useEffect(() => {
        // Submit initial prompt once when provided via -p/--prompt.
        if (!nonInteractiveInput || hasProcessedNonInteractiveRef.current || __nonInteractiveSubmittedOnce) return;
        const desiredTab = bootstrapConfig?.driver ? getTabByCliName(bootstrapConfig.driver) : null;
        if (desiredTab && selectedTab !== desiredTab.label) return;

        // Check if this tab requires a session
        const tabInfo = getTabInfoByLabel(selectedTab);
        const needsSession = selectedTab === Driver.AGENT || (tabInfo?.requiresSession ?? false);

        // Wait for session to be ready if needed
        if (needsSession && !agentSessionId) {
            addLog(`[NonInteractive] Waiting for session to initialize for tab: ${selectedTab}`);
            return; // Will retry when agentSessionId changes
        }

        hasProcessedNonInteractiveRef.current = true;
        __nonInteractiveSubmittedOnce = true;
        addLog(`Non-interactive mode: Processing input "${nonInteractiveInput}"`);

        const timeoutMs = process.env.E2E_WORKSPACE ? 7000 : 15000;
        let cancelled = false;

        const runNonInteractive = async () => {
            try {
                addLog(`[AutoSubmit] Submitting initial prompt...`);
                const success = await handleSubmit(nonInteractiveInput);
                if (bootstrapConfig.autoExit) {
                    addLog(`[AutoExit] Enabled; waiting for streams to idle (timeout=${timeoutMs}ms)`);
                    const idle = await waitForStreamsToIdle({
                        timeoutMs,
                        isCancelled: () => cancelled,
                        context: 'AutoExit',
                    });
                    addLog(`[AutoExit] Idle wait result: idle=${idle} success=${success}`);
                    const code = success ? 0 : (idle ? 0 : 1);
                    setTimeout(() => process.exit(code), 100);
                } else {
                    addLog('[AutoSubmit] autoExit disabled; remaining in interactive mode.');
                }
            } catch (err) {
                addLog(`[AutoSubmit] Error during non-interactive submission: ${err instanceof Error ? err.message : String(err)}`);
                if (bootstrapConfig.autoExit) {
                    setTimeout(() => process.exit(1), 100);
                }
            }
        };

        void runNonInteractive();

        return () => { cancelled = true; };
    }, [handleSubmit, nonInteractiveInput, selectedTab, bootstrapConfig?.driver, agentSessionId, waitForStreamsToIdle, bootstrapConfig.autoExit]);

    useEffect(() => {
        if (!e2eSteps || e2eSteps.length === 0 || nonInteractiveInput || automationRanRef.current) return;
        automationRanRef.current = true;
        let cancelled = false;
        const sleep = (ms = 0) => new Promise<void>(resolve => setTimeout(() => !cancelled && resolve(), Math.max(0, ms)));
        const getAllTabs = () => [...getStaticTabs(), ...(tasksRef.current ?? []).map((_, i) => `Task ${i + 1}`)];

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
                            if (step.waitForStream !== false) {
                                await waitForStreamsToIdle({
                                    timeoutMs: step.timeoutMs,
                                    isCancelled: () => cancelled,
                                    context: 'E2E',
                                });
                            }
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
    }, [e2eSteps, nonInteractiveInput, waitForStreamsToIdle]);

    // --- RENDER ---
    // Wait for tabs to be initialized before rendering
    if (!tabsInitialized) {
        return (
            <Box padding={1}>
                <Text color="gray">Loading...</Text>
            </Box>
        );
    }
    
    const staticTabs = getStaticTabs().filter(t => t !== 'Looper');
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

    return (
        <Box flexDirection="column" height="100%">
            <ChatPanel
                frozenMessages={frozenMessages}
                activeMessages={activeMessages}
                modelName={modelName}
                workspacePath={bootstrapConfig.workspacePath}
                positionalPromptWarning={positionalPromptWarning}
                sessionLabel={agentSessionId ? formatSessionId(agentSessionId) : null}
            />

            {/* Render input UI and TabView only when raw mode/input is supported */}
            {(() => {
                const inputSupported = !!(process.stdin && (process.stdin as any).isTTY && typeof (process.stdin as any).setRawMode === 'function');
                return (
                    <>
                        {inputSupported && <InputHandlers />}
                        <Box paddingY={1}>
                            {inputSupported && (agentPermissionPrompt ? (
                                <AgentPermissionPromptComponent
                                    prompt={agentPermissionPrompt}
                                    onSubmit={handlePermissionPromptSubmit}
                                    isFocused={focusedControl === 'permission'}
                                />
                            ) : (
                                inputSupported && (
                                    <InputBar
                                        value={inputValue}
                                        onChange={setInputValue}
                                        onSubmit={handleSubmit}
                                        isFocused={focusedControl === 'input'}
                                        onCommandMenuChange={setIsCommandMenuShown}
                                        onEscStateChange={handleEscStateChange}
                                        commands={inputCommands}
                                    />
                                )
                            ))}
                        </Box>
                        {activeTask && inputSupported && (
                            <TaskSpecificView
                                task={activeTask}
                                taskNumber={activeTaskNumber}
                                isFocused={focusedControl === 'task'}
                            />
                        )}
                        {inputSupported && (
                            <TabView
                                staticOptions={staticTabs}
                                tasks={tasks}
                                selectedTab={selectedTab}
                                onTabChange={setSelectedTab}
                                isFocused={focusedControl === 'tabs'}
                            />
                        )}
                        <Box paddingX={1} backgroundColor="gray">
                            <Text>
                                {(isEscActive ? "[Press ESC again to clear input]" : "Switch Driver: Ctrl+N") + ((bootstrapConfig.autoExit || bootstrapConfig.autoAllowPermissions) ? ` | Params: ${[bootstrapConfig.autoExit && '--auto-exit', bootstrapConfig.autoAllowPermissions && '--auto-allow'].filter(Boolean).join(' ')}` : '')}
                            </Text>
                        </Box>
                    </>
                );
            })()}
        </Box>
    );
};

// --- Render ---
const { stdin, stdout, stderr } = process;
if (process.env.E2E_SENTINEL && stdout.isTTY && typeof (stdout as any).setNoDelay === 'function') {
    (stdout as any).setNoDelay(true);
}
render(<App />, { stdin, stdout, stderr, debug: false, exitOnCtrlC: true, patchConsole: false });

// --- Cleanup on exit ---
process.on('exit', closeTaskLogger);
process.on('SIGINT', () => { closeTaskLogger(); process.exit(0); });
process.on('SIGTERM', () => { closeTaskLogger(); process.exit(0); });
