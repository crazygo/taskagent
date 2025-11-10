/**
 * Register all available agents
 *
 * This file registers all built-in agents with the global registry.
 * Import this file in the CLI entry point to ensure all agents are available.
 */

import { globalAgentRegistry } from './AgentRegistry.js';
import { createAgent as createStoryAgent } from '../blueprint/index.js';
import { createFeaturesEditorAgent } from '../blueprint/features-editor.js';
import { createAgent as createGlossaryAgent } from '../glossary/index.js';
import { createAgent as createUiReviewAgent } from '../ui-review/index.js';
import { createAgent as createCoderAgent } from '../coder/index.js';
import { createAgent as createReviewAgent } from '../review/index.js';
import { createAgent as createLooperAgent } from '../looper/index.js';
import { createAgent as createDevHubAgent } from '../devhub/index.js';
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
        factory: () => createStoryAgent({
            eventBus: options?.eventBus,
            tabExecutor: options?.tabExecutor,
            messageStore: options?.messageStore,
        }),
        description: 'Story Coordinator - Conversational requirements + workflow orchestration',
        tags: ['planning', 'documentation'],
    });

    globalAgentRegistry.register({
        id: 'features-editor',
        factory: createFeaturesEditorAgent,
        description: 'Features Editor - Planner + Graph + Summarizer',
        tags: ['planning', 'automation'],
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

    // DevHub Agent
    globalAgentRegistry.register({
        id: 'devhub',
        factory: () => createDevHubAgent({ 
            eventBus: options?.eventBus, 
            tabExecutor: options?.tabExecutor,
            messageStore: options?.messageStore
        }),
        description: 'DevHub Agent - 开发枢纽，协调开发与审查流程',
        tags: ['coordination', 'development', 'monitor'],
    });

    console.log('[AgentRegistry] Registered 9 agents: default, story, features-editor, glossary, ui-review, coder, review, looper, devhub');
}
