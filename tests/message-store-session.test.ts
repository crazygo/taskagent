import { describe, expect, test } from 'vitest';
import { MessageStore } from '../packages/cli/store/MessageStore.ts';
import type { Message } from '../packages/cli/types.js';

describe('MessageStore conversation flow', () => {
  test('assistant output remains after session system messages', () => {
    const store = new MessageStore();
    const tabId = 'Agent';

    const conversationQueues = new Map<string, Array<{ userMessageId: number; assistantMessageId: number; status: 'queued' | 'active' }>>();

    const appendSystemMessage = (content: string) => {
      const message: Message = {
        id: store.getNextMessageId(),
        role: 'system',
        content,
        timestamp: Date.now(),
      };
      store.appendMessage(tabId, message);
    };

    const ensureActiveEntry = () => {
      const queue = conversationQueues.get(tabId);
      if (!queue || queue.length === 0) return null;
      const entry = queue[0]!;
      if (entry.status === 'queued') {
        entry.status = 'active';
        store.mutateMessage(tabId, entry.assistantMessageId, msg => ({
          ...msg,
          queueState: 'active',
          isPending: true,
        }));
      }
      return entry;
    };

    const finalizeConversation = (updater?: (message: Message) => Message) => {
      const queue = conversationQueues.get(tabId);
      if (!queue || queue.length === 0) return;
      const current = queue.shift()!;
      if (updater) {
        store.mutateMessage(tabId, current.assistantMessageId, updater);
      } else {
        store.mutateMessage(tabId, current.assistantMessageId, msg => ({
          ...msg,
          isPending: false,
          queueState: 'completed',
        }));
      }
      if (!queue.length) {
        conversationQueues.delete(tabId);
        return;
      }
      const next = queue[0]!;
      next.status = 'active';
      store.mutateMessage(tabId, next.assistantMessageId, msg => ({
        ...msg,
        queueState: 'active',
        isPending: true,
      }));
    };

    const registerConversation = (userMessageId: number, assistantMessageId: number) => {
      const queue = conversationQueues.get(tabId) ?? [];
      const entry = { userMessageId, assistantMessageId, status: queue.length === 0 ? 'active' : 'queued' as const };
      queue.push(entry);
      conversationQueues.set(tabId, queue);
      store.mutateMessage(tabId, assistantMessageId, msg => ({
        ...msg,
        isPending: true,
        queueState: entry.status,
      }));
    };

    const userMessageId = store.getNextMessageId();
    store.appendMessage(tabId, { id: userMessageId, role: 'user', content: 'Hello session', queueState: 'active' });

    const assistantMessageId = store.getNextMessageId();
    store.appendMessage(tabId, { id: assistantMessageId, role: 'assistant', content: '', isPending: true, queueState: 'active' });

    registerConversation(userMessageId, assistantMessageId);

    appendSystemMessage('[Agent] Using session 123');

    const entry = ensureActiveEntry();
    expect(entry).not.toBeNull();
    store.mutateMessage(tabId, entry!.assistantMessageId, msg => ({
      ...msg,
      content: (msg.content ?? '') + 'Hello world!',
      queueState: 'active',
      isPending: true,
    }));

    finalizeConversation(msg => ({
      ...msg,
      content: msg.content || 'fallback',
      isPending: false,
      queueState: 'completed',
    }));

    appendSystemMessage('[Agent] Using session 123 again');

    const messages = store.getMessagesForTab(tabId);
    const assistant = messages.find(m => m.role === 'assistant');
    const systemMessages = messages.filter(m => m.role === 'system');

    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('Hello world!');
    expect(systemMessages.length).toBe(2);
    expect(messages.map(m => m.content)).toEqual([
      'Hello session',
      'Hello world!',
      '[Agent] Using session 123',
      '[Agent] Using session 123 again',
    ]);
  });
});
