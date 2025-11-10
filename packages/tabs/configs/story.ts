import type { TabConfig } from '../types.js';

export const storyTabConfig: TabConfig = {
  id: 'Story',
  label: 'Build Specs',
  type: 'agent',
  agentId: 'story',
  description: 'Build specs orchestration · Review and document user stories',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
  cliFlag: '--build-specs',
};
