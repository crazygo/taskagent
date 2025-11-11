import type { TabConfig } from '../types.js';

export const desktopTabConfig: TabConfig = {
  id: 'Desktop',
  label: 'Desktop',
  type: 'agent',
  agentId: 'desktop',
  description: 'Desktop · Unified interface for dispatching tasks to agents',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
  cliFlag: '--desktop',
};
