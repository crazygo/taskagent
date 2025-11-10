import type { TabConfig } from '../types.js';

export const storyTabConfig: TabConfig = {
  id: 'Story',
  label: 'Blueprint',
  type: 'agent',
  agentId: 'story',
  description: 'Blueprint orchestration · Review and document user stories',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
  cliFlag: '--blueprint',
};
