import { describe, it, expect, beforeEach } from 'vitest';
import { TabRegistry } from '../packages/tabs/TabRegistry.js';
import type { TabConfig } from '../packages/tabs/types.js';
import React from 'react';

const DummyComponent = (() => null) as React.FC<any>;

describe('TabRegistry', () => {
  let registry: TabRegistry;

  beforeEach(() => {
    registry = new TabRegistry();
  });

  const createTestTab = (id: string, overrides: Partial<TabConfig> = {}): TabConfig => ({
    id,
    label: id,
    type: 'agent',
    agentId: id.toLowerCase(),
    description: `${id} tab`,
    requiresSession: true,
    component: DummyComponent,
    ...overrides,
  });

  it('should register a tab', () => {
    const tab = createTestTab('Test');
    registry.register(tab);

    expect(registry.has('Test')).toBe(true);
    expect(registry.get('Test')).toEqual(tab);
  });

  it('should throw error on duplicate registration', () => {
    const tab = createTestTab('Test');
    registry.register(tab);

    expect(() => registry.register(tab)).toThrow('already registered');
  });

  it('should register multiple tabs', () => {
    const tabs = [
      createTestTab('Tab1'),
      createTestTab('Tab2'),
      createTestTab('Tab3'),
    ];

    registry.registerMany(tabs);

    expect(registry.getAll()).toHaveLength(3);
    expect(registry.has('Tab1')).toBe(true);
    expect(registry.has('Tab2')).toBe(true);
    expect(registry.has('Tab3')).toBe(true);
  });

  it('should maintain registration order', () => {
    registry.register(createTestTab('First'));
    registry.register(createTestTab('Second'));
    registry.register(createTestTab('Third'));

    const ids = registry.getTabIds();
    expect(ids).toEqual(['First', 'Second', 'Third']);
  });

  it('should filter tabs by type', () => {
    registry.register(createTestTab('Chat', { type: 'chat' }));
    registry.register(createTestTab('Agent1', { type: 'agent' }));
    registry.register(createTestTab('Agent2', { type: 'agent' }));

    const chatTabs = registry.getByType('chat');
    const agentTabs = registry.getByType('agent');

    expect(chatTabs).toHaveLength(1);
    expect(agentTabs).toHaveLength(2);
  });

  it('should find tabs by agent ID', () => {
    registry.register(createTestTab('Story', { agentId: 'story' }));
    registry.register(createTestTab('Glossary', { agentId: 'glossary' }));

    const storyTabs = registry.getByAgentId('story');
    expect(storyTabs).toHaveLength(1);
    expect(storyTabs[0].id).toBe('Story');
  });

  it('should find tab by CLI flag', () => {
    registry.register(createTestTab('Story', { cliFlag: '--blueprint' }));
    registry.register(createTestTab('Glossary', { cliFlag: '--glossary' }));

    const tab = registry.getByCliFlag('--blueprint');
    expect(tab?.id).toBe('Story');
  });

  it('should find tab by slash command', () => {
    registry.register(createTestTab('PRD', { slashCommand: '/plan-review-do' }));

    const tab = registry.getBySlashCommand('/plan-review-do');
    expect(tab?.id).toBe('PRD');
  });

  it('should provide accurate stats', () => {
    registry.register(createTestTab('Chat', { type: 'chat', requiresSession: false }));
    registry.register(createTestTab('Agent', { type: 'agent', requiresSession: true }));
    registry.register(createTestTab('Story', { type: 'agent', requiresSession: true, isPlaceholder: true }));

    const stats = registry.getStats();

    expect(stats.totalTabs).toBe(3);
    expect(stats.chatTabs).toBe(1);
    expect(stats.agentTabs).toBe(2);
    expect(stats.withSessions).toBe(2);
    expect(stats.placeholders).toBe(1);
  });

  it('should clear all tabs', () => {
    registry.register(createTestTab('Tab1'));
    registry.register(createTestTab('Tab2'));

    registry.clear();

    expect(registry.getAll()).toHaveLength(0);
    expect(registry.getTabIds()).toEqual([]);
  });
});

