import { useCallback, useRef } from 'react';
import { useMessageQueue } from '../hooks/useMessageQueue.ts';
import { useStreamSession } from '../hooks/useStreamSession.ts';
import type { Message, LogMessage } from '../types.ts';
import type { AiChatProvider } from '../config/ai-provider.ts';

interface UseConversationStoreOptions {
  aiProvider: AiChatProvider;
  modelName: string;
  reasoningEnabled: boolean;
  onSystemMessage?: (message: Message) => void;
  onActiveMessagesChange: React.Dispatch<React.SetStateAction<Message[]>>;
  onFrozenMessagesChange: React.Dispatch<React.SetStateAction<Message[]>>;
}

export const useConversationStore = ({
  aiProvider,
  modelName,
  reasoningEnabled,
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
    aiProvider,
    modelName,
    reasoningEnabled,
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
