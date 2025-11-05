import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import type { MessageStore } from '../store/MessageStore.js';
import type { Message } from '../types.js';

export interface MessageStoreSnapshot {
  frozen: Message[];
  active: Message[];
}

export function useMessageStoreTab(store: MessageStore, tabId: string): MessageStoreSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );

  const getSnapshot = useCallback(
    () => store.getPartitionedMessages(tabId),
    [store, tabId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
