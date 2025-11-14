import type { TabConfig } from '../types.js';

export const looperTabConfig: TabConfig = {
  id: 'Looper',
  label: 'Looper',
  type: 'agent',
  agentId: 'looper',
  description: 'Coder-Review循环执行引擎',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 50,
  isPlaceholder: false,
  cliFlag: '--looper',
};
