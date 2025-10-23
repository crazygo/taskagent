import { useState, useRef } from 'react';
import { streamText } from 'ai';
import { addLog } from '../logger.ts';
import type { AiChatProvider } from '../config/ai-provider.ts';
import { Message, LogMessage } from '../types.ts';

const STREAM_TOKEN_TIMEOUT_MS = 30_000;

interface UseStreamSessionProps {
  aiProvider: AiChatProvider;
  modelName: string;
  reasoningEnabled: boolean;
  setActiveMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setFrozenMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  pushSystemMessage: (content: string) => void;
  nextMessageId: () => number;
  conversationLogRef: React.MutableRefObject<LogMessage[]>;
}

export const useStreamSession = ({
  aiProvider,
  modelName,
  reasoningEnabled,
  setActiveMessages,
  setFrozenMessages,
  pushSystemMessage,
  nextMessageId,
  conversationLogRef,
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

  const runStreamForUserMessage = async (userMessage: Message): Promise<void> => {
    let streamError: Error | null = null;
    const normalizedUserMessage: Message = { ...userMessage, isPending: false };
    addLog(`[Stream] Starting turn with user content: ${normalizedUserMessage.content.replace(/\s+/g, ' ').slice(0, 120)}`);
    setIsStreaming(true);

    // Render: keep only pending placeholders then append current user message
    setActiveMessages(prev => {
      const pendingOnly = prev.filter(msg => msg.isPending);
      return [...pendingOnly, normalizedUserMessage];
    });

    conversationLogRef.current.push({ role: 'user', content: normalizedUserMessage.content });

    const assistantMessageId = nextMessageId();
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      reasoning: '',
    };

    setActiveMessages(prev => [...prev, { ...assistantPlaceholder, reasoning: '' }]);

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

    try {
      addLog(`Calling AI API with model: ${modelName}`);
      const messagesPayload = conversationLogRef.current
        .slice(0, assistantLogIndex)
        .map(({ role, content }) => ({ role, content }));

      const streamOptions: Record<string, any> = {
        model: aiProvider.chat(modelName),
        messages: messagesPayload,
        abortSignal: abortController.signal,
      };

      if (reasoningEnabled) {
        streamOptions.providerOptions = {
          openrouter: { reasoning: { effort: 'medium' } },
        };
      }

      const result: any = await streamText(streamOptions);

      addLog('AI stream started.');

      const processAssistantUpdate = () => {
        setActiveMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: assistantContent, reasoning: assistantReasoning }
              : msg
          )
        );
      };

      if (result && 'fullStream' in result && result.fullStream) {
        for await (const part of result.fullStream as AsyncIterable<any>) {
          addLog(`[Stream] Raw part: ${JSON.stringify(part)}`);
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
            addLog(
              `[Stream] Reasoning delta (${type || 'unknown'}): ${combinedReasoningDelta.replace(/\s+/g, ' ').slice(0, 120)}`
            );
            handled = true;
          }

          if (textDelta.length > 0) {
            assistantContent += textDelta;
            lastTokenAtRef.current = Date.now();
            addLog(
              `[Stream] Text delta (${type || 'unknown'}): ${textDelta.replace(/\s+/g, ' ').slice(0, 120)}`
            );
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
      addLog('[Stream] Completed assistant response.');
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const displayMessage = timedOut ? 'Stream timeout (10s without response).' : rawMessage;
      addLog(`[Stream] Error: ${displayMessage}`);
      conversationLogRef.current.splice(assistantLogIndex, 1);
      setActiveMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
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

    const completedMessages: Message[] = [{ ...normalizedUserMessage, isPending: false }];
    if (assistantSucceeded) {
      conversationLogRef.current[assistantLogIndex] = { role: 'assistant', content: assistantContent };
      completedMessages.push({
        id: assistantMessageId,
        role: 'assistant',
        content: assistantContent,
        reasoning: assistantReasoning,
      });
    }
    setFrozenMessages(prev => [...prev, ...completedMessages]);
    setActiveMessages(prev => prev.filter(msg => msg.isPending));

    if (streamError) {
      throw streamError;
    }
  };

  return {
    isStreaming,
    runStreamForUserMessage,
  };
};
