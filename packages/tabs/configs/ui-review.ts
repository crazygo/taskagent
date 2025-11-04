import type { TabConfig } from '../types.js';

export const uiReviewTabConfig: TabConfig = {
  id: 'UI',
  label: 'UI',
  type: 'agent',
  agentId: 'ui-review',
  description: 'UI Review specialist · ASCII wireframes with annotations',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
};

