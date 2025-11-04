import type { TabConfig } from '../types.js';

export const chatTabConfig: TabConfig = {
  id: 'Chat',
  label: 'Chat',
  type: 'chat',
  agentId: null, // Chat uses Vercel AI SDK directly, no agent
  description: 'Direct chat interface powered by Vercel AI SDK',
  requiresSession: false,
  executionMode: 'foreground',
  maxFrozenMessages: undefined, // No limit for active chat
  isPlaceholder: false,
};

