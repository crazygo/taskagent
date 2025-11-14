/**
 * MessageStore - Tab-partitioned message storage
 * 
 * Features:
 * - Messages stored per-tab (isolated by sourceTabId)
 * - Invisible tabs have configurable message limits (default: 20)
 * - Automatic separator line on tab switch
 * - Efficient message retrieval for current tab
 * - EventBus integration for cross-tab communication
 */

import { EventEmitter } from 'node:events';
import type { Message } from '../types.js';
import type { EventBus } from '../../core/event-bus/EventBus.js';
import { addLog } from '@shared/logger';

export interface MessageStoreConfig {
  /**
   * Maximum messages to keep for invisible (non-active) tabs
   * @default 20
   */
  invisibleTabLimit?: number;
  
  /**
   * Optional EventBus for cross-tab communication
   */
  eventBus?: EventBus;
}

interface TabMessages {
  messages: Message[];
  lastActive: number;
  version: number;
}

const SEPARATOR_MESSAGE: Omit<Message, 'id'> = {
  role: 'system',
  content: '─'.repeat(60),
  isBoxed: false,
};

type MessagePartition = 'active' | 'frozen';

const normalizeActive = (message: Message): Message => ({
  ...message,
  isPending: message.isPending ?? true,
  queueState: message.queueState ?? (message.isPending === false ? 'completed' : 'active'),
});

const normalizeFrozen = (message: Message): Message => ({
  ...message,
  isPending: false,
  queueState: message.queueState ?? 'completed',
});

export class MessageStore {
  private tabMessages: Map<string, TabMessages> = new Map();
  private currentTabId: string = 'Chat';
  private nextMessageId: number = 1;
  private config: Required<Pick<MessageStoreConfig, 'invisibleTabLimit'>>;
  private eventBus?: EventBus;
  private emitter = new EventEmitter();
  private batchDepth = 0;
  private pendingChange = false;
  private partitionCache = new Map<string, { version: number; value: { frozen: Message[]; active: Message[] } }>();

  constructor(config: MessageStoreConfig = {}) {
    this.config = {
      invisibleTabLimit: config.invisibleTabLimit ?? 20,
    };
    this.eventBus = config.eventBus;
  }

  /**
   * Get the current active tab ID
   */
  getCurrentTab(): string {
    return this.currentTabId;
  }

  /**
   * Switch to a different tab
   * Automatically adds a separator line when switching
   */
  setCurrentTab(tabId: string): void {
    if (this.currentTabId === tabId) {
      return; // No change
    }

    const previousTabId = this.currentTabId;
    this.currentTabId = tabId;

    // Update last active timestamp for new tab
    const tabData = this.getOrCreateTab(tabId);
    tabData.lastActive = Date.now();

    tabData.version += 1;
    // Add separator to new tab if it has messages
    if (tabData.messages.length > 0) {
      this.appendMessage(tabId, {
        ...SEPARATOR_MESSAGE,
        id: this.nextMessageId++,
      });
    }

    this.markDirty();

    // Trim invisible tab messages (previous tab is now invisible)
    this.trimInvisibleTab(previousTabId);
  }

  /**
   * Append a message to a specific tab
   */
  appendMessage(tabId: string, message: Message): void {
    const tabData = this.getOrCreateTab(tabId);
    tabData.messages.push(message);
    tabData.lastActive = Date.now();
    tabData.version += 1;
    this.partitionCache.delete(tabId);

    // Debug: log pending creations and current active count
    try {
      const { active } = this.partitionMessages(tabData.messages);
      if (message.isPending) {
        addLog(`[MessageStore] append pending: tab=${tabId} id=${message.id} role=${message.role} activeCount=${active.length}`);
      } else {
        addLog(`[MessageStore] append: tab=${tabId} id=${message.id} role=${message.role} activeCount=${active.length}`);
      }
    } catch {}

    this.markDirty();

    // Emit EventBus event for cross-tab communication
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'message:added',
        agentId: 'system',
        tabId,
        timestamp: Date.now(),
        version: '1.0',
        payload: {
          tabId,
          message: {
            id: message.id,
            role: message.role,
            content: message.content,
            isPending: message.isPending,
            queueState: message.queueState,
            isBoxed: message.isBoxed,
            variant: message.variant,
          },
        },
      });
    }

    // If this is not the current tab, trim immediately
    if (tabId !== this.currentTabId) {
      this.trimInvisibleTab(tabId);
    }
  }

  /**
   * Append multiple messages to a specific tab (batch operation)
   */
  appendMessages(tabId: string, messages: Message[]): void {
    const tabData = this.getOrCreateTab(tabId);
    tabData.messages.push(...messages);
    tabData.lastActive = Date.now();
    tabData.version += 1;
    this.partitionCache.delete(tabId);

    this.markDirty();

    if (tabId !== this.currentTabId) {
      this.trimInvisibleTab(tabId);
    }
  }

  /**
   * Get all visible messages for the current tab
   */
  getVisibleMessages(): Message[] {
    const tabData = this.tabMessages.get(this.currentTabId);
    return tabData ? [...tabData.messages] : [];
  }

  /**
   * Get messages for a specific tab (useful for testing/debugging)
   */
  getMessagesForTab(tabId: string): Message[] {
    const tabData = this.tabMessages.get(tabId);
    return tabData ? [...tabData.messages] : [];
  }

  /**
   * Get the next message ID
   */
  getNextMessageId(): number {
    return this.nextMessageId++;
  }

  /**
   * Clear all messages for a specific tab
   */
  clearTab(tabId: string): void {
    this.tabMessages.delete(tabId);
    this.partitionCache.delete(tabId);
    this.markDirty();
  }

  /**
   * Clear all messages across all tabs
   */
  clearAll(): void {
    this.tabMessages.clear();
    this.nextMessageId = 1;
    this.partitionCache.clear();
    this.markDirty();
  }

  /**
   * Get statistics for debugging
   */
  getStats(): {
    totalTabs: number;
    currentTab: string;
    tabSizes: Record<string, number>;
    invisibleLimit: number;
  } {
    const tabSizes: Record<string, number> = {};
    for (const [tabId, data] of this.tabMessages.entries()) {
      tabSizes[tabId] = data.messages.length;
    }

    return {
      totalTabs: this.tabMessages.size,
      currentTab: this.currentTabId,
      tabSizes,
      invisibleLimit: this.config.invisibleTabLimit,
    };
  }

  /**
   * Mutate a message within a tab by cloning and applying the provided mutator.
   * No-op if the message cannot be found.
   */
  mutateMessage(tabId: string, messageId: number, mutator: (message: Message) => Message): void {
    const tabData = this.tabMessages.get(tabId);
    if (!tabData) return;

    const index = tabData.messages.findIndex(msg => msg.id === messageId);
    if (index === -1) return;

    const current = tabData.messages[index]!;
    const prevPending = !!current.isPending;
    const updated = mutator({ ...current });
    tabData.messages[index] = updated;
    tabData.version += 1;
    this.partitionCache.delete(tabId);

    // Debug: log pending state transitions and active count
    try {
      const { active } = this.partitionMessages(tabData.messages);
      if (prevPending !== !!updated.isPending) {
        addLog(`[MessageStore] mutate pending->${!!updated.isPending}: tab=${tabId} id=${messageId} role=${updated.role} activeCount=${active.length}`);
      }
    } catch {}

    this.markDirty();
  }

  /**
   * Remove a message by ID from a tab.
   */
  removeMessage(tabId: string, messageId: number): void {
    const tabData = this.tabMessages.get(tabId);
    if (!tabData) return;

    const index = tabData.messages.findIndex(msg => msg.id === messageId);
    if (index === -1) return;

    tabData.messages.splice(index, 1);
    tabData.version += 1;
    this.partitionCache.delete(tabId);
    this.markDirty();
  }

  /**
   * Subscribe to message store changes.
   * Returns an unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    this.emitter.on('change', listener);
    return () => {
      this.emitter.off('change', listener);
    };
  }

  /**
   * Partition messages for a tab into frozen (completed) and active (pending) lists.
   */
  /**
   * Get or create tab data structure
   */
  private getOrCreateTab(tabId: string): TabMessages {
    let tabData = this.tabMessages.get(tabId);
    if (!tabData) {
      tabData = {
        messages: [],
        lastActive: Date.now(),
        version: 0,
      };
      this.tabMessages.set(tabId, tabData);
    }
    return tabData;
  }

  /**
   * Trim messages for an invisible tab to the configured limit
   */
  private trimInvisibleTab(tabId: string): void {
    if (tabId === this.currentTabId) {
      return; // Don't trim the active tab
    }

    const tabData = this.tabMessages.get(tabId);
    if (!tabData) {
      return;
    }

    const limit = this.config.invisibleTabLimit;
    if (tabData.messages.length > limit) {
      // Keep only the most recent messages
      tabData.messages = tabData.messages.slice(-limit);
      tabData.version += 1;
      this.partitionCache.delete(tabId);
      this.markDirty();
    }
  }

  private markDirty(): void {
    if (this.batchDepth > 0) {
      this.pendingChange = true;
    } else {
      this.emitter.emit('change');
    }
  }

  batchUpdate(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.pendingChange) {
        this.pendingChange = false;
        this.emitter.emit('change');
      }
    }
  }

  getPartitionedMessages(tabId: string): { frozen: Message[]; active: Message[] } {
    const tabData = this.getOrCreateTab(tabId);

    const cached = this.partitionCache.get(tabId);
    if (cached && cached.version === tabData.version) {
      return cached.value;
    }

    const value = this.partitionMessages(tabData.messages);
    this.partitionCache.set(tabId, { version: tabData.version, value });
    return value;
  }

  updateActiveMessages(tabId: string, updater: (prev: Message[]) => Message[]): void {
    this.updatePartition(tabId, 'active', updater);
  }

  updateFrozenMessages(tabId: string, updater: (prev: Message[]) => Message[]): void {
    this.updatePartition(tabId, 'frozen', updater);
  }

  private partitionMessages(messages: Message[]): { frozen: Message[]; active: Message[] } {
    const frozen: Message[] = [];
    const active: Message[] = [];

    for (const message of messages) {
      if (message.isPending) {
        active.push(message);
      } else {
        frozen.push(message);
      }
    }

    return { frozen, active };
  }

  private updatePartition(tabId: string, partition: MessagePartition, updater: (prev: Message[]) => Message[]): void {
    const tabData = this.getOrCreateTab(tabId);
    const { frozen, active } = this.partitionMessages(tabData.messages);
    const current = partition === 'active' ? active : frozen;
    const next = updater([...current]);

    let newMessages: Message[];
    if (partition === 'active') {
      const normalized = next.map(normalizeActive);
      newMessages = [...frozen, ...normalized];
    } else {
      const normalized = next.map(normalizeFrozen);
      newMessages = [...normalized, ...active];
    }

    tabData.messages = newMessages;
    tabData.version += 1;
    this.partitionCache.delete(tabId);
    this.markDirty();
  }
}
