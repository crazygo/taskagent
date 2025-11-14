import type { TabConfig } from '../types.js';

export const startTabConfig: TabConfig = {
  id: 'Start',
  label: 'Start',
  type: 'agent',
  agentId: 'start',
  description: 'Start · Unified interface for dispatching tasks to agents',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
  cliFlag: '--start',
};
