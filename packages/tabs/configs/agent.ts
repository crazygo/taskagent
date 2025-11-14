import type { TabConfig } from '../types.js';

export const agentTabConfig: TabConfig = {
  id: 'Agent',
  label: 'Agent',
  type: 'agent',
  agentId: 'default', // Uses PromptAgent (passthrough)
  description: 'Claude Agent SDK with full tool access',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: undefined, // No limit for primary agent tab
  isPlaceholder: false,
};

