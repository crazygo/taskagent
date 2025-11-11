import { useCallback, useEffect, useRef } from 'react';
import { addLog } from '@taskagent/shared/logger';
import type { EventBus } from '@taskagent/core/event-bus';
import type { AgentEvent } from '@taskagent/core/types/AgentEvent.js';
import type { MessageStore } from '../store/MessageStore.js';
import type { Message } from '../types.js';
import type { ToolUseEvent, ToolResultEvent } from '@taskagent/agents/runtime/runClaudeStream.js';

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
    const newId = messageStore.getNextMessageId();
    const message: Message = {
      id: newId,
      role: 'system',
      content,
      isBoxed: boxed,
      isPending: false,
      timestamp: Date.now(),
    };
    messageStore.appendMessage(tabId, message);
    addLog(`[AgentBridge] appendSystemMessage completed for msgId=${newId}; raw=${JSON.stringify({ tabId, content, boxed })}`);
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
      const msg = messages[index]!;
      if (msg && msg.isPending) {
        // Remove from current position
        messageStore.removeMessage(tabId, current.assistantMessageId);
        
        // Create finalized version and append to end
        const finalized: Message = updater ? updater(msg) : {
          ...msg,
          isPending: false,
          queueState: 'completed' as const,
        } as Message;
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
      // Looper is independent of the conversation queue
      if (event.tabId === 'Looper') {
        const chunk = typeof event.payload === 'string' ? event.payload : '';
        if (chunk) {
          addLog(`[AgentBridge] Looper text (queue-independent) len=${chunk.length}`);
          messageStore.appendMessage('Looper', {
            id: messageStore.getNextMessageId(),
            role: 'assistant',
            content: chunk,
            reasoning: '',
            isPending: false,
            timestamp: event.timestamp,
          });
        }
        return; // Do not engage queue logic for Looper
      }

      // Skip entry check - allow all agent outputs to be displayed
      // (TabExecutionManager already handles concurrent execution control)
      
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
      // Skip entry check - allow all reasoning to be displayed
      
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
      addLog(`[AgentBridge] handleAgentEvent called for tab ${event.tabId}, payload=${JSON.stringify(event.payload)}`);
      ensureActiveEntry(event.tabId);
      const payload = event.payload;

      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'session') {
        const sessionId = (payload as any).sessionId;
        addLog(`[AgentBridge] Skip handling session event: ${sessionId}`);
        return;
      }


      if (payload && typeof payload === 'object' && 'result' in payload) {
        const resultText = typeof (payload as any).result === 'string'
          ? (payload as any).result
          : '';
        addLog(`[AgentBridge] Forwarding result event: ${resultText.length}`);
        finalizeConversation(event.tabId);
        return;
      }

      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'tool_use') {
        const toolUse = payload as unknown as ToolUseEvent;
        const toolName = toolUse.name;
        const description = toolUse.description;
        addLog(`[ToolUI] Forwarding tool use: ${toolName}${description ? ` - ${description}` : ''}`);
        messageStore.appendMessage(event.tabId, {
          id: messageStore.getNextMessageId(),
          role: 'tool_use',
          content: toolUse?.input as string ?? '',
          toolName: toolName || 'Tool',
          toolDescription: description,
          toolId: toolUse.id,
          timestamp: event.timestamp,
        });
        return;
      }

      if (payload && typeof payload === 'object' && 'type' in payload && (payload as any).type === 'tool_result') {
        const toolResult = payload as unknown as ToolResultEvent;
          const toolName = toolResult.name;
          const durationMs = toolResult.durationMs;
          const content = toolResult.content ?? '';
          const firstLine = content.split('\n')[0] ?? '';
          let contentPreview = firstLine.slice(0, 50).trim();
          // 如果被截断，回退到最后一个完整单词
          if (firstLine.length > 50) {
            const lastSpace = contentPreview.lastIndexOf(' ');
            if (lastSpace > 0) {
              contentPreview = contentPreview.slice(0, lastSpace);
            }
          }
          if (contentPreview.endsWith(': [')) {
            contentPreview = contentPreview.slice(0, -2);
          }
          if (contentPreview.endsWith(': {')) {
            contentPreview = contentPreview.slice(0, -2);
          }
          if (contentPreview.endsWith(':')) {
            contentPreview = contentPreview.slice(0, -1);
          }
          addLog(`[ToolUI] Forwarding tool result: ${toolName}${durationMs ? ` (${(durationMs / 1000).toFixed(1)}s)` : ''}`);
          messageStore.appendMessage(event.tabId, {
            id: messageStore.getNextMessageId(),
            role: 'tool_result',
            content: contentPreview,
            toolName: toolName || 'Tool',
            toolIsError: toolResult.isError ?? false,
            toolId: toolResult.id,
            durationMs,
            timestamp: event.timestamp,
          });
          return;
      }
      if (payload && typeof payload === 'object' && 'message' in payload) {
        let message = String((payload as any).message ?? '');
        
        if (!message) return;

        // Handle Looper events (progress/result)
        if (message.startsWith('looper:')) {
          const looperPayload = (payload as any).payload;
          
          // looper:result - don't display, will be handled by DevHub
          if (message === 'looper:result') {
            addLog(`[AgentBridge] Skipping looper:result (handled by DevHub)`);
            return;
          }
          
          // looper:progress - display as assistant message
          if (message === 'looper:progress' && looperPayload) {
            addLog(`[AgentBridge] Forwarding looper:progress as assistant message`);
            messageStore.appendMessage(event.tabId, {
              id: messageStore.getNextMessageId(),
              role: 'assistant',
              content: String(looperPayload),
              isPending: false,
              timestamp: event.timestamp,
            });
            return;
          }
        }

        addLog(`[AgentBridge] Forwarding non-tool message, uuid=: ${(payload as any).uuid}`);
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
      // Safety: ensure no leftover pending placeholders remain active
      messageStore.updateActiveMessages(event.tabId, prev => prev.map(msg => ({ ...msg, isPending: false, queueState: 'completed' })));
      const ts = new Date((event as any).timestamp ?? Date.now()).toISOString();
      appendSystemMessage(event.tabId, `${ts} ◼︎`);
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

    const handleTaskProgress = (event: AgentEvent) => {
      const payload = event.payload;
      if (payload && typeof payload === 'object' && 'message' in payload) {
        const message = String((payload as any).message);
        const agentId = event.agentId || 'unknown';
        addLog(`[AgentBridge] Task progress: ${message}`);
        messageStore.appendMessage(event.tabId, {
          id: messageStore.getNextMessageId(),
          role: 'assistant',
          content: `✦ [${agentId}] ${message}`,
          isPending: false,
          timestamp: event.timestamp,
        });
      }
    };

    const handleTaskResult = (event: AgentEvent) => {
      const payload = event.payload;
      addLog(`[AgentBridge] Task result: ${JSON.stringify(payload)}`);
      if (payload && typeof payload === 'object') {
        if ('error' in payload) {
          appendSystemMessage(event.tabId, `Task failed: ${(payload as any).error}`, true);
        } else {
          const summary = JSON.stringify(payload, null, 2);
          messageStore.appendMessage(event.tabId, {
            id: messageStore.getNextMessageId(),
            role: 'assistant',
            content: `✓ Task completed\n${summary}`,
            isPending: false,
            timestamp: event.timestamp,
          });
        }
      }
    };

    eventBus.on('agent:text', handleText);
    eventBus.on('agent:reasoning', handleReasoning);
    eventBus.on('agent:event', handleAgentEvent);
    eventBus.on('agent:completed', handleCompleted);
    eventBus.on('agent:failed', handleFailed);
    eventBus.on('task:progress', handleTaskProgress);
    eventBus.on('task:result', handleTaskResult);

    return () => {
      eventBus.off('agent:text', handleText);
      eventBus.off('agent:reasoning', handleReasoning);
      eventBus.off('agent:event', handleAgentEvent);
      eventBus.off('agent:completed', handleCompleted);
      eventBus.off('agent:failed', handleFailed);
      eventBus.off('task:progress', handleTaskProgress);
      eventBus.off('task:result', handleTaskResult);
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
