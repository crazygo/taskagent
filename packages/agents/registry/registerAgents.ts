/**
 * Register all available agents
 *
 * This file registers all built-in agents with the global registry.
 * Import this file in the CLI entry point to ensure all agents are available.
 */

import { globalAgentRegistry } from './AgentRegistry.js';
import { createAgent as createStoryAgent } from '../story/index.js';
import { createAgent as createGlossaryAgent } from '../glossary/index.js';
import { createAgent as createUiReviewAgent } from '../ui-review/index.js';
import { createAgent as createMonitorAgent } from '../monitor/index.js';
import { DefaultAtomicAgent } from '../runtime/types.js';

/**
 * Register all built-in agents
 */
export function registerAllAgents(): void {
    // Default Agent (passthrough for Agent tab)
    globalAgentRegistry.register({
        id: 'default',
        factory: async () => new DefaultAtomicAgent(),
        description: 'Default Agent - Direct Claude Code access',
        tags: ['default', 'passthrough'],
    });

    // Story Agent
    globalAgentRegistry.register({
        id: 'story',
        factory: createStoryAgent,
        description: 'Story Builder - Creates and manages user stories',
        tags: ['planning', 'documentation'],
    });

    // Glossary Agent
    globalAgentRegistry.register({
        id: 'glossary',
        factory: createGlossaryAgent,
        description: 'Glossary Manager - Manages project terminology',
        tags: ['documentation', 'search'],
    });

    // UI Review Agent
    globalAgentRegistry.register({
        id: 'ui-review',
        factory: createUiReviewAgent,
        description: 'UI Reviewer - Reviews UI components and UX',
        tags: ['review', 'ui'],
    });

    // Log Monitor Agent
    globalAgentRegistry.register({
        id: 'log-monitor',
        factory: createMonitorAgent,
        description: 'Log Monitor - Monitors debug logs and git changes',
        tags: ['monitoring', 'logs'],
    });

    console.log('[AgentRegistry] Registered 5 agents: default, story, glossary, ui-review, log-monitor');
}