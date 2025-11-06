import { describe, expect, it } from 'vitest';

import {
  createMessageQueueController,
  type QueuedUserInput,
} from '../packages/cli/hooks/useMessageQueue.js';

const buildQueuedInput = (id: number): QueuedUserInput => ({
  tabId: 'Story',
  message: {
    id,
    role: 'user',
    content: `queued-${id}`,
  },
  userPlaceholderId: id,
  assistantPlaceholderId: id + 1000,
});

describe('createMessageQueueController', () => {
  it('flushes entries sequentially and recovers after errors', async () => {
    const controller = createMessageQueueController();
    const processedIds: number[] = [];

    controller.enqueue(buildQueuedInput(1));
    controller.enqueue(buildQueuedInput(2));

    await controller.flush(async entry => {
      processedIds.push(entry.message.id);
    });

    expect(processedIds).toEqual([1, 2]);
    expect(controller.size).toBe(0);
    expect(controller.isProcessing).toBe(false);

    controller.enqueue(buildQueuedInput(3));

    await expect(
      controller.flush(async () => {
        throw new Error('expected failure');
      })
    ).rejects.toThrow('expected failure');

    expect(controller.isProcessing).toBe(false);
    expect(controller.size).toBe(0);

    controller.enqueue(buildQueuedInput(4));
    const finalIds: number[] = [];
    await controller.flush(async entry => {
      finalIds.push(entry.message.id);
    });

    expect(finalIds).toEqual([4]);
    expect(controller.isProcessing).toBe(false);
    expect(controller.size).toBe(0);
  });
});
