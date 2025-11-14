import { useState, useRef } from 'react';
import { streamText } from 'ai';
import { addLog } from '@shared/logger';
import type { AiChatProvider } from '../config/ai-provider.js';
import type { Message, LogMessage } from '../types.js';
import type { MessageStore } from '../store/MessageStore.js';

const STREAM_TOKEN_TIMEOUT_MS = 30_000;

interface StreamPlaceholders {
  userId: number;
  assistantId: number;
}

export interface RunStreamOptions {
  placeholders?: StreamPlaceholders;
  tabId?: string;
}

interface UseStreamSessionProps {
  aiProvider: AiChatProvider;
  modelName: string;
  reasoningEnabled: boolean;
  pushSystemMessage: (content: string) => void;
  nextMessageId: () => number;
  conversationLogRef: React.MutableRefObject<LogMessage[]>;
  messageStore: MessageStore;
  getActiveTabId: () => string;
}

export const useStreamSession = ({
  aiProvider,
  modelName,
  reasoningEnabled,
  pushSystemMessage,
  nextMessageId,
  conversationLogRef,
  messageStore,
  getActiveTabId,
}: UseStreamSessionProps) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTokenAtRef = useRef<number>(0);

  const clearStreamWatchdog = () => {
    if (streamTimeoutRef.current) {
      clearInterval(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
  };

  const extractReasoningFromContent = (content: any): string => {
    if (!content) return '';
    if (Array.isArray(content)) {
      return content
        .map(item => {
          const itemType = String(item?.type ?? '').toLowerCase();
          const itemText = typeof item?.text === 'string' ? item.text : '';
          if (!itemText) return '';
          if (itemType.includes('reasoning')) {
            return itemText;
          }
          if (itemType === 'message' && Array.isArray(item?.content)) {
            return extractReasoningFromContent(item.content);
          }
          return '';
        })
        .join('');
    }
    if (typeof content === 'object') {
      return [
        extractReasoningFromContent((content as any).content),
        typeof (content as any).text === 'string' && String((content as any).type).toLowerCase().includes('reasoning')
          ? (content as any).text
          : '',
      ].join('');
    }
    return '';
  };

  const extractTextFromContent = (content: any): string => {
    if (!content) return '';
    if (Array.isArray(content)) {
      return content
        .map(item => {
          const itemType = String(item?.type ?? '').toLowerCase();
          const itemText = typeof item?.text === 'string' ? item.text : '';
          if (!itemText) return '';
          if (
            itemType.includes('output') ||
            itemType.includes('text') ||
            itemType === 'message'
          ) {
            if (itemType === 'message' && Array.isArray(item?.content)) {
              return extractTextFromContent(item.content);
            }
            return itemText;
          }
          return '';
        })
        .join('');
    }
    if (typeof content === 'object') {
      return [
        extractTextFromContent((content as any).content),
        typeof (content as any).text === 'string' &&
        (String((content as any).type).toLowerCase().includes('text') ||
          String((content as any).type).toLowerCase().includes('output'))
          ? (content as any).text
          : '',
      ].join('');
    }
    return '';
  };

  const runStreamForUserMessage = async (userMessage: Message, options?: RunStreamOptions): Promise<void> => {
    let streamError: Error | null = null;
    const placeholders = options?.placeholders;
    const tabId = options?.tabId ?? getActiveTabId();
    const normalizedUserMessage: Message = { ...userMessage, isPending: false };

    let userMessageId = normalizedUserMessage.id;
    let assistantMessageId: number;

    setIsStreaming(true);

    conversationLogRef.current.push({ role: 'user', content: normalizedUserMessage.content });

    if (placeholders) {
      userMessageId = placeholders.userId;
      assistantMessageId = placeholders.assistantId;

      messageStore.mutateMessage(tabId, userMessageId, msg => ({
        ...msg,
        content: normalizedUserMessage.content,
        isPending: false,
        queueState: 'active',
      }));

      messageStore.mutateMessage(tabId, assistantMessageId, msg => ({
        ...msg,
        content: '',
        reasoning: '',
        isPending: true,
        queueState: 'active',
      }));
    } else {
      messageStore.appendMessage(tabId, normalizedUserMessage);

      assistantMessageId = nextMessageId();
      const assistantPlaceholder: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        reasoning: '',
        isPending: true,
        queueState: 'active',
      };

      messageStore.appendMessage(tabId, assistantPlaceholder);
    }

    const assistantLogIndex = conversationLogRef.current.push({ role: 'assistant', content: '' }) - 1;

    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;
    lastTokenAtRef.current = Date.now();

    clearStreamWatchdog();
    let timedOut = false;
    let assistantContent = '';
    let assistantReasoning = '';
    streamTimeoutRef.current = setInterval(() => {
      if (Date.now() - lastTokenAtRef.current > STREAM_TOKEN_TIMEOUT_MS) {
        addLog('Stream timeout reached (10s without new tokens). Aborting request.');
        timedOut = true;
        abortController.abort();
      }
    }, 1000);
    let assistantSucceeded = false;

    const processAssistantUpdate = () => {
      messageStore.mutateMessage(tabId, assistantMessageId, msg => ({
        ...msg,
        content: assistantContent,
        reasoning: assistantReasoning,
        isPending: true,
        queueState: 'active',
      }));
    };

    try {
      addLog(`Calling AI API with model: ${modelName}`);
      const messagesPayload = conversationLogRef.current
        .slice(0, assistantLogIndex)
        .map(({ role, content }) => ({ role, content }));

      const streamOptions = {
        model: aiProvider.chat(modelName),
        messages: messagesPayload,
        abortSignal: abortController.signal,
        ...(reasoningEnabled && { 
          providerOptions: {
            openrouter: { reasoning: { effort: 'medium' } },
          }
        })
      };

      const result: any = await streamText(streamOptions);

      addLog('AI stream started.');

      if (result && 'fullStream' in result && result.fullStream) {
        for await (const part of result.fullStream as AsyncIterable<any>) {
          const type = String(part?.type ?? '');
          const normalizedType = type.toLowerCase();

          const reasoningPieces: string[] = [];
          if (normalizedType.includes('reasoning')) {
            const typedReasoning = part?.text ?? part?.textDelta ?? part?.delta?.text;
            if (typeof typedReasoning === 'string') {
              reasoningPieces.push(typedReasoning);
            }
          }
          const explicitReasoningFields = [
            part?.delta?.reasoning,
            part?.delta?.reasoning_text,
            part?.delta?.reasoning_delta,
            part?.delta?.reasoning_content, // Specific to https://open.bigmodel.cn/api/coding/paas/v4
            part?.reasoning,
            part?.reasoning_delta,
          ];
          explicitReasoningFields.forEach(value => {
            if (typeof value === 'string' && value.length > 0) {
              reasoningPieces.push(value);
            }
          });
          if (Array.isArray(part?.reasoning_details)) {
            const joined = part.reasoning_details
              .map((d: any) => (typeof d?.text === 'string' ? d.text : ''))
              .join('');
            if (joined.length > 0) {
              reasoningPieces.push(joined);
            }
          }
          reasoningPieces.push(extractReasoningFromContent(part?.delta?.content));
          reasoningPieces.push(extractReasoningFromContent(part?.content));
          const combinedReasoningDelta = reasoningPieces.join('');

          const textPieces: string[] = [];
          const pushTextPiece = (value: unknown) => {
            if (typeof value === 'string' && value.length > 0) {
              textPieces.push(value);
            }
          };
          if (normalizedType.includes('text') || normalizedType.includes('output')) {
            pushTextPiece(part?.textDelta);
            pushTextPiece(part?.delta?.text_delta);
            pushTextPiece(part?.delta?.output_text_delta);
            pushTextPiece(part?.delta?.output_text);
            pushTextPiece(part?.delta?.text);
            pushTextPiece(part?.text);
          } else {
            pushTextPiece(part?.delta?.output_text);
            pushTextPiece(part?.delta?.text);
            if (!normalizedType.includes('reasoning')) {
              pushTextPiece(part?.textDelta);
              pushTextPiece(part?.text);
            }
          }
          textPieces.push(extractTextFromContent(part?.delta?.content));
          textPieces.push(extractTextFromContent(part?.content));
          const textDelta = textPieces.join('');

          let handled = false;
          if (combinedReasoningDelta.length > 0) {
            assistantReasoning += combinedReasoningDelta;
            lastTokenAtRef.current = Date.now();
            handled = true;
          }

          if (textDelta.length > 0) {
            assistantContent += textDelta;
            lastTokenAtRef.current = Date.now();
            conversationLogRef.current[assistantLogIndex] = { role: 'assistant', content: assistantContent };
            handled = true;
          }

          if (handled) {
            processAssistantUpdate();
          }
        }
      } else if (result && 'textStream' in result && result.textStream) {
        for await (const delta of result.textStream as AsyncIterable<string>) {
          if (!delta) continue;
          assistantContent += delta;
          lastTokenAtRef.current = Date.now();
          processAssistantUpdate();
          conversationLogRef.current[assistantLogIndex] = { role: 'assistant', content: assistantContent };
        }
      }

      assistantSucceeded = true;

    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const displayMessage = timedOut ? 'Stream timeout (30s without response).' : rawMessage;

      conversationLogRef.current.splice(assistantLogIndex, 1);
      if (placeholders) {
        messageStore.mutateMessage(tabId, assistantMessageId, msg => ({
          ...msg,
          content: `Error: ${displayMessage}`,
          isPending: false,
          queueState: 'completed',
        }));
      } else {
        messageStore.removeMessage(tabId, assistantMessageId);
      }
      pushSystemMessage(`Error: ${displayMessage}`);
      if (error instanceof Error) {
        streamError = error;
        streamError.message = displayMessage;
      } else {
        streamError = new Error(displayMessage);
      }
    } finally {
      clearStreamWatchdog();
      streamAbortControllerRef.current = null;
      setIsStreaming(false);
    }

    if (assistantSucceeded) {
      conversationLogRef.current[assistantLogIndex] = { role: 'assistant', content: assistantContent };
      messageStore.mutateMessage(tabId, assistantMessageId, msg => ({
        ...msg,
        content: assistantContent,
        reasoning: assistantReasoning,
        isPending: false,
        queueState: 'completed',
      }));
    }

    messageStore.mutateMessage(tabId, userMessageId, msg => ({
      ...msg,
      queueState: 'completed',
      isPending: false,
    }));

    if (streamError) {
      throw streamError;
    }
  };

  return {
    isStreaming,
    runStreamForUserMessage,
  };
};
