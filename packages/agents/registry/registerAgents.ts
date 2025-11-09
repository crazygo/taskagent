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
import { createAgent as createCoderAgent } from '../coder/index.js';
import { createAgent as createReviewAgent } from '../review/index.js';
import { createAgent as createLooperAgent } from '../looper/index.js';
import { createAgent as createMediatorAgent } from '../mediator/index.js';
import { DefaultPromptAgent } from '../runtime/types.js';

/**
 * Register all built-in agents
 */
export function registerAllAgents(options?: { eventBus?: any; tabExecutor?: any; taskManager?: any; messageStore?: any }): void {
    // Default Agent (passthrough for Agent tab)
    globalAgentRegistry.register({
        id: 'default',
        factory: async () => new DefaultPromptAgent(),
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

    // Coder Agent
    globalAgentRegistry.register({
        id: 'coder',
        factory: createCoderAgent,
        description: 'Coder Agent - Backend development executor with self-testing',
        tags: ['development', 'coding', 'monitor'],
    });

    // Review Agent
    globalAgentRegistry.register({
        id: 'review',
        factory: createReviewAgent,
        description: 'Review Agent - Unified code review, progress summary, and quality monitoring',
        tags: ['review', 'quality', 'monitor'],
    });

    // Looper Agent
    globalAgentRegistry.register({
        id: 'looper',
        factory: () => createLooperAgent({ taskManager: options?.taskManager }),
        description: 'Looper Agent - Coder-Review循环执行引擎',
        tags: ['automation', 'loop', 'monitor'],
    });

    // Mediator Agent
    globalAgentRegistry.register({
        id: 'mediator',
        factory: () => createMediatorAgent({ 
            eventBus: options?.eventBus, 
            tabExecutor: options?.tabExecutor,
            messageStore: options?.messageStore
        }),
        description: 'Mediator Agent - 对话路由器，协调任务执行',
        tags: ['coordination', 'routing', 'monitor'],
    });

    console.log('[AgentRegistry] Registered 8 agents: default, story, glossary, ui-review, coder, review, looper, mediator');
}