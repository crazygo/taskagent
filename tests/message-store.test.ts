import { describe, it, expect, beforeEach } from 'vitest';
import { MessageStore } from '../packages/cli/store/MessageStore.js';
import type { Message } from '../packages/cli/types.js';

describe('MessageStore', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore({ invisibleTabLimit: 5 });
  });

  it('should initialize with default tab', () => {
    expect(store.getCurrentTab()).toBe('Chat');
    expect(store.getVisibleMessages()).toEqual([]);
  });

  it('should append messages to current tab', () => {
    const msg1: Message = { id: 1, role: 'user', content: 'Hello' };
    const msg2: Message = { id: 2, role: 'assistant', content: 'Hi!' };

    store.appendMessage('Chat', msg1);
    store.appendMessage('Chat', msg2);

    expect(store.getVisibleMessages()).toHaveLength(2);
    expect(store.getVisibleMessages()[0].content).toBe('Hello');
  });

  it('should partition messages by tab', () => {
    store.appendMessage('Chat', { id: 1, role: 'user', content: 'Chat msg' });
    store.appendMessage('Story', { id: 2, role: 'user', content: 'Story msg' });

    expect(store.getMessagesForTab('Chat')).toHaveLength(1);
    expect(store.getMessagesForTab('Story')).toHaveLength(1);
    expect(store.getVisibleMessages()).toHaveLength(1); // Only current tab
  });

  it('should add separator when switching tabs', () => {
    store.appendMessage('Chat', { id: 1, role: 'user', content: 'Hello' });
    store.setCurrentTab('Story');
    store.appendMessage('Story', { id: 2, role: 'user', content: 'Story' });
    
    store.setCurrentTab('Chat');
    
    const messages = store.getVisibleMessages();
    expect(messages).toHaveLength(2); // Original + separator
    expect(messages[1].content).toMatch(/─+/);
  });

  it('should trim invisible tab messages to limit', () => {
    // Add 10 messages to Story tab
    for (let i = 1; i <= 10; i++) {
      store.appendMessage('Story', { id: i, role: 'user', content: `Msg ${i}` });
    }

    // Switch away to make Story invisible
    store.setCurrentTab('Chat');

    // Story should be trimmed to 5 messages (invisibleTabLimit)
    const storyMessages = store.getMessagesForTab('Story');
    expect(storyMessages).toHaveLength(5);
    expect(storyMessages[0].content).toBe('Msg 6'); // Should keep last 5
  });

  it('should not trim active tab', () => {
    for (let i = 1; i <= 10; i++) {
      store.appendMessage('Chat', { id: i, role: 'user', content: `Msg ${i}` });
    }

    expect(store.getVisibleMessages()).toHaveLength(10); // No trimming for active tab
  });

  it('should generate unique message IDs', () => {
    const id1 = store.getNextMessageId();
    const id2 = store.getNextMessageId();
    const id3 = store.getNextMessageId();

    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
  });

  it('should provide accurate stats', () => {
    store.appendMessage('Chat', { id: 1, role: 'user', content: 'A' });
    store.appendMessage('Story', { id: 2, role: 'user', content: 'B' });
    store.appendMessage('Story', { id: 3, role: 'user', content: 'C' });

    const stats = store.getStats();
    expect(stats.totalTabs).toBe(2);
    expect(stats.currentTab).toBe('Chat');
    expect(stats.tabSizes['Chat']).toBe(1);
    expect(stats.tabSizes['Story']).toBe(2);
    expect(stats.invisibleLimit).toBe(5);
  });

  it('should clear tab messages', () => {
    store.appendMessage('Chat', { id: 1, role: 'user', content: 'Hello' });
    store.clearTab('Chat');

    expect(store.getVisibleMessages()).toEqual([]);
  });

  it('should clear all tabs', () => {
    store.appendMessage('Chat', { id: 1, role: 'user', content: 'A' });
    store.appendMessage('Story', { id: 2, role: 'user', content: 'B' });
    
    store.clearAll();

    expect(store.getMessagesForTab('Chat')).toEqual([]);
    expect(store.getMessagesForTab('Story')).toEqual([]);
    expect(store.getNextMessageId()).toBe(1); // ID counter reset
  });
});

