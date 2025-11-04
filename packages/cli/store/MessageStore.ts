/**
 * MessageStore - Tab-partitioned message storage
 * 
 * Features:
 * - Messages stored per-tab (isolated by sourceTabId)
 * - Invisible tabs have configurable message limits (default: 20)
 * - Automatic separator line on tab switch
 * - Efficient message retrieval for current tab
 */

import type { Message } from '../types.js';

export interface MessageStoreConfig {
  /**
   * Maximum messages to keep for invisible (non-active) tabs
   * @default 20
   */
  invisibleTabLimit?: number;
}

interface TabMessages {
  messages: Message[];
  lastActive: number;
}

const SEPARATOR_MESSAGE: Omit<Message, 'id'> = {
  role: 'system',
  content: '─'.repeat(60),
  isBoxed: false,
};

export class MessageStore {
  private tabMessages: Map<string, TabMessages> = new Map();
  private currentTabId: string = 'Chat';
  private nextMessageId: number = 1;
  private config: Required<MessageStoreConfig>;

  constructor(config: MessageStoreConfig = {}) {
    this.config = {
      invisibleTabLimit: config.invisibleTabLimit ?? 20,
    };
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

    // Add separator to new tab if it has messages
    if (tabData.messages.length > 0) {
      this.appendMessage(tabId, {
        ...SEPARATOR_MESSAGE,
        id: this.nextMessageId++,
      });
    }

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
  }

  /**
   * Clear all messages across all tabs
   */
  clearAll(): void {
    this.tabMessages.clear();
    this.nextMessageId = 1;
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
   * Get or create tab data structure
   */
  private getOrCreateTab(tabId: string): TabMessages {
    let tabData = this.tabMessages.get(tabId);
    if (!tabData) {
      tabData = {
        messages: [],
        lastActive: Date.now(),
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
    }
  }
}

