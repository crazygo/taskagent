import type { TabConfig } from '../types.js';

export const monitorTabConfig: TabConfig = {
  id: 'Mediator',
  label: 'Mediator',
  type: 'agent',
  agentId: 'mediator',
  description: 'Mediator · 对话路由器，协调任务执行',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 50,
  isPlaceholder: false,
  cliFlag: '--mediator',
};

