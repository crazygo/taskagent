import { useCallback, useEffect, useRef } from 'react';
import { addLog } from '@taskagent/shared/logger';
import type { EventBus } from '@taskagent/core/event-bus';
import type { AgentEvent } from '@taskagent/core/types/AgentEvent.js';
import type { MessageStore } from '../store/MessageStore.js';
import type { Message } from '../types.js';

type ConversationStatus = 'queued' | 'active';

interface ConversationEntry {
  userMessageId: number;
  assistantMessageId: number;
  status: ConversationStatus;
}

const TOOL_USE_REGEX = /^Tool:\s+(\w+)(?:\s+-\s+(.+))?$/i;
const TOOL_RESULT_REGEX = /^Tool\s+(\w+)\s+completed(?:\s+\(([^)]+)\))?/i;

export interface AgentConversationRegistry {
  registerConversation: (
    tabId: string,
    userMessageId: number,
    assistantMessageId: number
  ) => number;
  getQueueLength: (tabId: string) => number;
}

export function useAgentEventBridge(eventBus: EventBus, messageStore: MessageStore): AgentConversationRegistry {
  const conversationQueuesRef = useRef<Map<string, ConversationEntry[]>>(new Map());

  const appendSystemMessage = useCallback((tabId: string, content: string, boxed = false) => {
    const message: Message = {
      id: messageStore.getNextMessageId(),
      role: 'system',
      content,
      isBoxed: boxed,
      timestamp: Date.now(),
    };
    messageStore.appendMessage(tabId, message);
  }, [messageStore]);

  const ensureActiveEntry = useCallback((tabId: string): ConversationEntry | null => {
    const queue = conversationQueuesRef.current.get(tabId);
    if (!queue || queue.length === 0) {
      return null;
    }

    const entry = queue[0]!;
    if (entry.status === 'queued') {
      entry.status = 'active';
      messageStore.mutateMessage(tabId, entry.assistantMessageId, msg => ({
        ...msg,
        queueState: 'active',
        isPending: true,
      }));
    }
    return entry;
  }, [messageStore]);

  const finalizeConversation = useCallback((tabId: string, updater?: (message: Message) => Message) => {
    const queue = conversationQueuesRef.current.get(tabId);
    if (!queue || queue.length === 0) {
      return;
    }

    const current = queue.shift()!;
    if (updater) {
      messageStore.mutateMessage(tabId, current.assistantMessageId, updater);
    } else {
      messageStore.mutateMessage(tabId, current.assistantMessageId, msg => ({
        ...msg,
        isPending: false,
        queueState: 'completed',
      }));
    }

    if (!queue.length) {
      conversationQueuesRef.current.delete(tabId);
      return;
    }

    const next = queue[0]!;
    next.status = 'active';
    messageStore.mutateMessage(tabId, next.assistantMessageId, msg => ({
      ...msg,
      queueState: 'active',
      isPending: true,
    }));
  }, [messageStore]);

  useEffect(() => {
    const handleText = (event: AgentEvent) => {
      const entry = ensureActiveEntry(event.tabId);
      if (!entry) return;

      const chunk = typeof event.payload === 'string' ? event.payload : '';
      if (!chunk) return;

      messageStore.mutateMessage(event.tabId, entry.assistantMessageId, msg => ({
        ...msg,
        content: (msg.content ?? '') + chunk,
        queueState: 'active',
        isPending: true,
      }));
    };

    const handleReasoning = (event: AgentEvent) => {
      const entry = ensureActiveEntry(event.tabId);
      if (!entry) return;

      const chunk = typeof event.payload === 'string' ? event.payload : '';
      if (!chunk) return;

      messageStore.mutateMessage(event.tabId, entry.assistantMessageId, msg => ({
        ...msg,
        reasoning: (msg.reasoning ?? '') + chunk,
        queueState: 'active',
        isPending: true,
      }));
    };

    const handleAgentEvent = (event: AgentEvent) => {
      ensureActiveEntry(event.tabId);
      const payload = event.payload;

      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'session') {
        const sessionId = (payload as any).sessionId;
        if (typeof sessionId === 'string') {
          appendSystemMessage(event.tabId, `[Agent] Using session ${sessionId}`, false);
        }
        return;
      }

      if (payload && typeof payload === 'object' && 'message' in payload) {
        const message = String((payload as any).message ?? '');
        if (!message) return;

        const toolUseMatch = message.match(TOOL_USE_REGEX);
        const toolResultMatch = message.match(TOOL_RESULT_REGEX);

        if (toolUseMatch) {
          const [, toolName, description] = toolUseMatch;
          messageStore.appendMessage(event.tabId, {
            id: messageStore.getNextMessageId(),
            role: 'tool_use',
            content: '',
            toolName: toolName || 'Tool',
            toolDescription: description,
            timestamp: event.timestamp,
          });
          addLog(`[ToolUI] Tool use: ${toolName}${description ? ` - ${description}` : ''}`);
          return;
        }

        if (toolResultMatch) {
          const [, toolName, durationStr] = toolResultMatch;
          const durationMs = durationStr ? parseFloat(durationStr.replace('s', '')) * 1000 : undefined;
          messageStore.appendMessage(event.tabId, {
            id: messageStore.getNextMessageId(),
            role: 'tool_result',
            content: '',
            toolName: toolName || 'Tool',
            durationMs,
            timestamp: event.timestamp,
          });
          addLog(`[ToolUI] Tool result: ${toolName}${durationMs ? ` (${durationMs}ms)` : ''}`);
          return;
        }

        appendSystemMessage(event.tabId, message, (payload as any).level === 'error');
        return;
      }

      if (typeof payload === 'string') {
        appendSystemMessage(event.tabId, payload);
      }
    };

    const handleCompleted = (event: AgentEvent) => {
      const fullText = typeof event.payload === 'string' ? event.payload : '';
      finalizeConversation(event.tabId, msg => ({
        ...msg,
        content: fullText || msg.content,
        isPending: false,
        queueState: 'completed',
      }));
    };

    const handleFailed = (event: AgentEvent) => {
      const errorMessage = typeof event.payload === 'string' ? event.payload : 'Agent execution failed';
      finalizeConversation(event.tabId, msg => ({
        ...msg,
        isPending: false,
        queueState: 'completed',
      }));
      appendSystemMessage(event.tabId, `[Agent] Failed: ${errorMessage}`, true);
    };

    eventBus.on('agent:text', handleText);
    eventBus.on('agent:reasoning', handleReasoning);
    eventBus.on('agent:event', handleAgentEvent);
    eventBus.on('agent:completed', handleCompleted);
    eventBus.on('agent:failed', handleFailed);

    return () => {
      eventBus.off('agent:text', handleText);
      eventBus.off('agent:reasoning', handleReasoning);
      eventBus.off('agent:event', handleAgentEvent);
      eventBus.off('agent:completed', handleCompleted);
      eventBus.off('agent:failed', handleFailed);
    };
  }, [appendSystemMessage, ensureActiveEntry, finalizeConversation, eventBus, messageStore]);

  const registerConversation = useCallback((
    tabId: string,
    userMessageId: number,
    assistantMessageId: number,
  ): number => {
    const queue = conversationQueuesRef.current.get(tabId) ?? [];
    const entry: ConversationEntry = {
      userMessageId,
      assistantMessageId,
      status: queue.length === 0 ? 'active' : 'queued',
    };

    queue.push(entry);
    conversationQueuesRef.current.set(tabId, queue);

    messageStore.mutateMessage(tabId, assistantMessageId, msg => ({
      ...msg,
      isPending: true,
      queueState: entry.status,
    }));

    return queue.length - 1; // number of items ahead in queue
  }, [messageStore]);

  const getQueueLength = useCallback((tabId: string): number => {
    const queue = conversationQueuesRef.current.get(tabId);
    return queue ? queue.length : 0;
  }, []);

  return {
    registerConversation,
    getQueueLength,
  };
}
