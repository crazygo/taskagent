import type { TabConfig } from '../types.js';

export const monitorTabConfig: TabConfig = {
  id: 'DevHub',
  label: 'DevHub',
  type: 'agent',
  agentId: 'devhub',
  description: 'DevHub · 开发枢纽，协调开发与审查流程',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 50,
  isPlaceholder: false,
  cliFlag: '--devhub',
};

