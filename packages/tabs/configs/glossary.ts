import type { TabConfig } from '../types.js';

export const glossaryTabConfig: TabConfig = {
  id: 'Glossary',
  label: 'Glossary',
  type: 'agent',
  agentId: 'glossary',
  description: 'Project glossary curator · Manage and understand terminology',
  requiresSession: true,
  executionMode: 'foreground',
  maxFrozenMessages: 20,
  isPlaceholder: false,
  cliFlag: '--glossary',
};

