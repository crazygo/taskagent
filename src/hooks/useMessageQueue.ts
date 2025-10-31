import { useRef } from 'react';
import { addLog } from '../logger.js';
import type { Message } from '../types.js';

interface UseMessageQueueProps {
  runStreamForUserMessage: (message: Message) => Promise<void>;
  setActiveMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  nextMessageId: () => number;
}

export const useMessageQueue = ({ runStreamForUserMessage, setActiveMessages, nextMessageId }: UseMessageQueueProps) => {
  const pendingUserInputsRef = useRef<Message[]>([]);
  const isProcessingQueueRef = useRef(false);

  const flushPendingQueue = async () => {
    if (pendingUserInputsRef.current.length === 0) {
      return;
    }

    isProcessingQueueRef.current = true;

    try {
      while (pendingUserInputsRef.current.length > 0) {
        const batch = pendingUserInputsRef.current.splice(0, pendingUserInputsRef.current.length);
        const batchSummary = batch.map(msg => msg.content.replace(/\s+/g, ' ').trim()).join(' | ');
        addLog(`[Queue] Flushing ${batch.length} queued input(s): ${batchSummary}`);

        const idsToRemove = new Set(batch.map(msg => msg.id));
        setActiveMessages(prev => prev.filter(msg => !(msg.isPending && idsToRemove.has(msg.id))));

        const mergedContent = batch.map(msg => msg.content).join('\n');
        const trimmed = mergedContent.trim();

        if (trimmed.length === 0) {
          addLog('[Queue] Merged content was empty after trimming; skipping send.');
          continue;
        }

        const mergedMessage: Message = {
          id: nextMessageId(),
          role: 'user',
          content: mergedContent,
        };

        await runStreamForUserMessage(mergedMessage);
      }
    } finally {
      isProcessingQueueRef.current = false;
    }
  };

  return {
    pendingUserInputsRef,
    isProcessingQueueRef,
    flushPendingQueue,
  };
};
