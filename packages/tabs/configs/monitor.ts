import type { TabConfig } from '../types.js';

export const monitorTabConfig: TabConfig = {
  id: 'Monitor',
  label: 'Monitor',
  type: 'agent',
  agentId: 'log-monitor',
  description: 'Log monitor · Track debug logs, task logs, and git changes',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 50, // Higher limit for monitoring logs
  isPlaceholder: false,
};

