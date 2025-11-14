import { useCallback, useRef } from 'react';
import { addLog } from '@shared/logger';
import type { Message } from '../types.js';

export interface QueuedUserInput {
  tabId: string;
  message: Message;
  userPlaceholderId: number;
  assistantPlaceholderId: number;
}

export interface MessageQueueController {
  enqueue(entry: QueuedUserInput): void;
  flush(processEntry: (entry: QueuedUserInput) => Promise<void>): Promise<void>;
  readonly isProcessing: boolean;
  readonly size: number;
}

export const createMessageQueueController = (): MessageQueueController => {
  const queue: QueuedUserInput[] = [];
  let processing = false;

  return {
    enqueue(entry: QueuedUserInput) {
      queue.push(entry);
    },
    async flush(processEntry: (entry: QueuedUserInput) => Promise<void>) {
      if (queue.length === 0 || processing) {
        return;
      }

      processing = true;

      try {
        while (queue.length > 0) {
          const entry = queue.shift()!;
          const summary = entry.message.content.replace(/\s+/g, ' ').trim();
          addLog(`[Queue] Flushing queued input: ${summary || '(empty)'}`);
          try {
            await processEntry(entry);
          } catch (error) {
            throw error;
          }
        }
      } finally {
        processing = false;
      }
    },
    get isProcessing() {
      return processing;
    },
    get size() {
      return queue.length;
    },
  };
};

export const useMessageQueue = () => {
  const controllerRef = useRef<MessageQueueController>(createMessageQueueController());
  const isProcessingQueueRef = useRef(false);

  const enqueueQueuedInput = useCallback((entry: QueuedUserInput) => {
    controllerRef.current.enqueue(entry);
  }, []);

  const flushQueuedInputs = useCallback(
    async (processEntry: (entry: QueuedUserInput) => Promise<void>) => {
      if (controllerRef.current.size === 0 || controllerRef.current.isProcessing) {
        return;
      }

      isProcessingQueueRef.current = true;
      try {
        await controllerRef.current.flush(processEntry);
      } finally {
        isProcessingQueueRef.current = false;
      }
    },
    []
  );

  return {
    enqueueQueuedInput,
    flushQueuedInputs,
    isProcessingQueueRef,
  };
};
