import { useCallback, useRef } from 'react';
import { useMessageQueue } from '../hooks/useMessageQueue.ts';
import { useStreamSession } from '../hooks/useStreamSession.ts';
import type { Message, LogMessage } from '../types.ts';
import type { OpenRouterClient } from '../config/openrouter.ts';

interface UseConversationStoreOptions {
  openrouter: OpenRouterClient;
  onSystemMessage?: (message: Message) => void;
  onActiveMessagesChange: React.Dispatch<React.SetStateAction<Message[]>>;
  onFrozenMessagesChange: React.Dispatch<React.SetStateAction<Message[]>>;
}

export const useConversationStore = ({
  openrouter,
  onSystemMessage,
  onActiveMessagesChange,
  onFrozenMessagesChange,
}: UseConversationStoreOptions) => {
  const systemMessageCallback = onSystemMessage ?? (() => {});
  const conversationLogRef = useRef<LogMessage[]>([]);
  const messageIdRef = useRef(0);

  const nextMessageId = useCallback(() => {
    messageIdRef.current += 1;
    return messageIdRef.current;
  }, []);

  const pushSystemMessage = useCallback((content: string) => {
    const systemMessage: Message = {
      id: nextMessageId(),
      role: 'system',
      content,
      isBoxed: true,
    };
    onActiveMessagesChange(prev => [...prev, systemMessage]);
    onFrozenMessagesChange(prev => [...prev, systemMessage]);
    conversationLogRef.current.push({ role: 'system', content });
    systemMessageCallback(systemMessage);
  }, [nextMessageId, onActiveMessagesChange, onFrozenMessagesChange, systemMessageCallback]);

  const { isStreaming, runStreamForUserMessage } = useStreamSession({
    openrouter,
    setActiveMessages: onActiveMessagesChange,
    setFrozenMessages: onFrozenMessagesChange,
    pushSystemMessage,
    nextMessageId,
    conversationLogRef,
  });

  const { pendingUserInputsRef, isProcessingQueueRef, flushPendingQueue } = useMessageQueue({
    runStreamForUserMessage,
    setActiveMessages: onActiveMessagesChange,
    nextMessageId,
  });

  return {
    isStreaming,
    runStreamForUserMessage,
    pendingUserInputsRef,
    isProcessingQueueRef,
    flushPendingQueue,
    nextMessageId,
    conversationLogRef,
    pushSystemMessage,
  };
};
