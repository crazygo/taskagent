import type { TabConfig } from '../types.js';

export const blueprintTabConfig: TabConfig = {
  id: 'Blueprint',
  label: 'Blueprint',
  type: 'agent',
  agentId: 'blueprint',
  description: 'Blueprint orchestration · Review and document user stories',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
  cliFlag: '--blueprint',
};
