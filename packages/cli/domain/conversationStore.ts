import { useCallback, useRef } from 'react';
import { useMessageQueue, type QueuedUserInput } from '../hooks/useMessageQueue.js';
import { useStreamSession } from '../hooks/useStreamSession.js';
import type { Message, LogMessage } from '../types.js';
import type { AiChatProvider } from '../config/ai-provider.js';
import type { MessageStore } from '../store/MessageStore.js';

interface UseConversationStoreOptions {
  aiProvider: AiChatProvider;
  modelName: string;
  reasoningEnabled: boolean;
  onSystemMessage?: (message: Message) => void;
  messageStore: MessageStore;
  getActiveTabId: () => string;
}

export const useConversationStore = ({
  aiProvider,
  modelName,
  reasoningEnabled,
  onSystemMessage,
  messageStore,
  getActiveTabId,
}: UseConversationStoreOptions) => {
  const systemMessageCallback = onSystemMessage ?? (() => {});
  const conversationLogRef = useRef<LogMessage[]>([]);

  const nextMessageId = useCallback(() => {
    return messageStore.getNextMessageId();
  }, [messageStore]);

  const pushSystemMessage = useCallback((content: string) => {
    const systemMessage: Message = {
      id: nextMessageId(),
      role: 'system',
      content,
      isBoxed: true,
    };
    const tabId = getActiveTabId();
    messageStore.appendMessage(tabId, systemMessage);
    conversationLogRef.current.push({ role: 'system', content });
    systemMessageCallback(systemMessage);
  }, [getActiveTabId, messageStore, nextMessageId, systemMessageCallback]);

  const { isStreaming, runStreamForUserMessage } = useStreamSession({
    aiProvider,
    modelName,
    reasoningEnabled,
    pushSystemMessage,
    nextMessageId,
    conversationLogRef,
    messageStore,
    getActiveTabId,
  });

  const { enqueueQueuedInput, flushQueuedInputs, isProcessingQueueRef } = useMessageQueue();

  const enqueueUserInput = useCallback((entry: QueuedUserInput) => {
    enqueueQueuedInput(entry);
  }, [enqueueQueuedInput]);

  const flushPendingQueue = useCallback(async () => {
    await flushQueuedInputs(async entry => {
      await runStreamForUserMessage(entry.message, {
        placeholders: {
          userId: entry.userPlaceholderId,
          assistantId: entry.assistantPlaceholderId,
        },
        tabId: entry.tabId,
      });
    });
  }, [flushQueuedInputs, runStreamForUserMessage]);

  return {
    isStreaming,
    runStreamForUserMessage,
    enqueueUserInput,
    isProcessingQueueRef,
    flushPendingQueue,
    nextMessageId,
    conversationLogRef,
    pushSystemMessage,
  };
};
