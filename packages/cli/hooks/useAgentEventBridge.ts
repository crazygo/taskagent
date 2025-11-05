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
      isPending: false,
      timestamp: Date.now(),
    };
    messageStore.appendMessage(tabId, message);
    addLog(`[AgentBridge] appendSystemMessage completed for msgId=${message.id}`);
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
      addLog(`[AgentBridge] Activated queued conversation for tab ${tabId} (assistant=${entry.assistantMessageId})`);
    }
    return entry;
  }, [messageStore]);

  const finalizeConversation = useCallback((tabId: string, updater?: (message: Message) => Message) => {
    const queue = conversationQueuesRef.current.get(tabId);
    if (!queue || queue.length === 0) {
      return;
    }

    const current = queue.shift()!;
    addLog(`[AgentBridge] Finalizing conversation for tab ${tabId} (assistant=${current.assistantMessageId})`);
    
    // Move message to end to preserve frozen append order
    const messages = messageStore.getMessagesForTab(tabId);
    const index = messages.findIndex(m => m.id === current.assistantMessageId);
    if (index !== -1) {
      const msg = messages[index];
      if (!msg) {
        addLog(`[AgentBridge] Message not found at index ${index} for tab ${tabId}`);
        return;
      }
      if (msg.isPending) {
        // Remove from current position
        messageStore.removeMessage(tabId, current.assistantMessageId);
        
        // Create finalized version and append to end
        const finalized = updater ? updater(msg) : {
          ...msg,
          isPending: false,
          queueState: 'completed' as const,
        };
        messageStore.appendMessage(tabId, finalized);
      } else if (updater) {
        // Already finalized, just mutate in place
        messageStore.mutateMessage(tabId, current.assistantMessageId, updater);
      }
    }

    if (!queue.length) {
      conversationQueuesRef.current.delete(tabId);
      addLog(`[AgentBridge] Queue cleared for tab ${tabId}`);
      return;
    }

    const next = queue[0]!;
    next.status = 'active';
    messageStore.mutateMessage(tabId, next.assistantMessageId, msg => ({
      ...msg,
      queueState: 'active',
      isPending: true,
    }));
    addLog(`[AgentBridge] Promoted queued conversation for tab ${tabId} (assistant=${next.assistantMessageId})`);
  }, [messageStore]);

  useEffect(() => {
    const handleText = (event: AgentEvent) => {
      const entry = ensureActiveEntry(event.tabId);
      if (!entry) return;

      const chunk = typeof event.payload === 'string' ? event.payload : '';
      if (!chunk) return;

      // Emit assistant text as finalized message to interleave with tool logs
      messageStore.appendMessage(event.tabId, {
        id: messageStore.getNextMessageId(),
        role: 'assistant',
        content: chunk,
        reasoning: '',
        isPending: false,
        timestamp: event.timestamp,
      });
    };

    const handleReasoning = (event: AgentEvent) => {
      const entry = ensureActiveEntry(event.tabId);
      if (!entry) return;

      const chunk = typeof event.payload === 'string' ? event.payload : '';
      if (!chunk) return;

      // Emit assistant reasoning as finalized message to interleave with tool logs
      messageStore.appendMessage(event.tabId, {
        id: messageStore.getNextMessageId(),
        role: 'assistant',
        content: '',
        reasoning: chunk,
        isPending: false,
        timestamp: event.timestamp,
      });
    };

    const handleAgentEvent = (event: AgentEvent) => {
      addLog(`[AgentBridge] handleAgentEvent called for tab ${event.tabId}, event.type=${event.type}, timestamp=${event.timestamp}`);
      ensureActiveEntry(event.tabId);
      const payload = event.payload;

      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'session') {
        const sessionId = (payload as any).sessionId;
        if (typeof sessionId === 'string') {
          addLog(`[AgentBridge] Session event received for tab ${event.tabId}: ${sessionId}`);
        }
        return;
      }

      addLog(`[AgentBridge] received event for tab ${event.tabId}, with payload: ${JSON.stringify(payload)}`);

      // Filter out SDK internal messages (type=user with message object)
      // These are tool_result messages sent back to the model, not for UI display
      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'user') {
        addLog(`[AgentBridge] Ignoring SDK internal user message`);
        return;
      }

      if (payload && typeof payload === 'object' && 'result' in payload) {
        const resultText = typeof (payload as any).result === 'string'
          ? (payload as any).result
          : '';
        addLog(`[AgentBridge] Result event received for tab ${event.tabId} (len=${resultText.length})`);
        finalizeConversation(event.tabId);
        return;
      }

      if (payload && typeof payload === 'object' && 'message' in payload) {
        const messageField = (payload as any).message;
        
        // Debug: Log message field type and content
        addLog(`[AgentBridge] payload.message type=${typeof messageField}, value=${JSON.stringify(messageField).substring(0, 200)}`);
        
        const message = String(messageField ?? '');
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
      addLog(`[AgentBridge] handleCompleted called for tab ${event.tabId}, timestamp=${event.timestamp}`);
      finalizeConversation(event.tabId);
      const ts = new Date((event as any).timestamp ?? Date.now()).toISOString();
      appendSystemMessage(event.tabId, `◼︎ ${ts}`);
    };

    const handleFailed = (event: AgentEvent) => {
      const errorMessage = typeof event.payload === 'string' ? event.payload : 'Agent execution failed';
      finalizeConversation(event.tabId, msg => ({
        ...msg,
        content: '✗ Failed',
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

    addLog(`[AgentBridge] Registered conversation for tab ${tabId} (user=${userMessageId}, assistant=${assistantMessageId}, position=${queue.length - 1})`);

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
