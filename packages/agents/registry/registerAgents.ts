/**
 * Register all available agents
 *
 * This file registers all built-in agents with the global registry.
 * Import this file in the CLI entry point to ensure all agents are available.
 */

import { globalAgentRegistry } from './AgentRegistry.js';
import { createAgent as createStartAgent } from '../desktop/index.js';
import { createAgent as createBlueprintAgent } from '../blueprint/index.js';
import { createAgent as createFeatureWriterAgent } from '../feature-writer/index.js';
import { createAgent as createGlossaryAgent } from '../glossary/index.js';
import { createAgent as createUiReviewAgent } from '../ui-review/index.js';
import { createAgent as createCoderAgent } from '../coder/index.js';
import { createAgent as createReviewAgent } from '../review/index.js';
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

    // Start Agent
    globalAgentRegistry.register({
        id: 'start',
        factory: () => createStartAgent({
            eventBus: options?.eventBus,
            tabExecutor: options?.tabExecutor,
            messageStore: options?.messageStore,
            agentRegistry: globalAgentRegistry,
        }),
        description: 'Start - Unified interface for dispatching tasks to agents',
        tags: ['coordination', 'orchestration'],
    });

    // Blueprint Agent
    globalAgentRegistry.register({
        id: 'blueprint',
        factory: () => createBlueprintAgent({
            eventBus: options?.eventBus,
            tabExecutor: options?.tabExecutor,
            messageStore: options?.messageStore,
            agentRegistry: globalAgentRegistry,
        }),
        description: 'Blueprint Coordinator - Conversational requirements + workflow orchestration',
        tags: ['planning', 'documentation'],
    });

    // Feature Writer Agent
    globalAgentRegistry.register({
        id: 'feature-writer',
        factory: () => createFeatureWriterAgent({
            tabExecutor: options?.tabExecutor,
            eventBus: options?.eventBus,
            agentRegistry: globalAgentRegistry,
        }),
        description: 'Feature Writer - Write structured feature YAML files',
        tags: ['atomic', 'writer'],
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
        factory: () => createCoderAgent({
            tabExecutor: options?.tabExecutor,
            eventBus: options?.eventBus,
            agentRegistry: globalAgentRegistry,
        }),
        description: 'Coder Agent - Backend development executor with self-testing',
        tags: ['development', 'coding', 'monitor'],
    });

    // Review Agent
    globalAgentRegistry.register({
        id: 'review',
        factory: () => createReviewAgent({
            tabExecutor: options?.tabExecutor,
            eventBus: options?.eventBus,
            agentRegistry: globalAgentRegistry,
        }),
        description: 'Review Agent - Unified code review, progress summary, and quality monitoring',
        tags: ['review', 'quality', 'monitor'],
    });

    // DevHub Agent
    globalAgentRegistry.register({
        id: 'devhub',
        factory: () => createDevHubAgent({ 
            eventBus: options?.eventBus, 
            tabExecutor: options?.tabExecutor,
            messageStore: options?.messageStore,
            taskManager: options?.taskManager,
            agentRegistry: globalAgentRegistry,
        }),
        description: 'DevHub Agent - 开发枢纽，协调开发与审查流程',
        tags: ['coordination', 'development', 'monitor'],
    });

    // Log registered agents dynamically
    const registeredIds = globalAgentRegistry.getAllIds();
    console.log(`[AgentRegistry] Registered ${registeredIds.length} agents: ${registeredIds.join(', ')}`);
}
