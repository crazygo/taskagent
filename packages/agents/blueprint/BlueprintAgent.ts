/**
 * BlueprintAgent - Wrapper around BlueprintLoop
 * 
 * Simplified architecture:
 * - No coordinator/dialogue capability
 * - Directly starts loop on receiving task
 * - PromptAgent interface for compatibility with Start Agent
 */

import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../runtime/types.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { BlueprintLoop } from './BlueprintLoop.js';
import { addLog } from '@taskagent/shared/logger';

const BLUEPRINT_AGENT_ID = 'blueprint';

interface BlueprintAgentDeps {
    tabExecutor?: any;
    agentRegistry?: AgentRegistry;
    eventBus?: EventBus;
    systemPrompt?: string;
    agentDefinitions?: any;
    allowedTools?: string[];
}

export class BlueprintAgent extends PromptAgent implements RunnableAgent {
    readonly id = BLUEPRINT_AGENT_ID;
    readonly description = 'Blueprint Agent - Generate structured feature documentation with edit-validate loop';

    private loop?: BlueprintLoop;

    constructor(private deps: BlueprintAgentDeps) {
        super();
    }

    async initialize() {
        if (!this.deps.agentRegistry) {
            throw new Error('Blueprint requires agentRegistry');
        }
        if (!this.deps.eventBus) {
            throw new Error('Blueprint requires eventBus');
        }
        if (!this.deps.tabExecutor) {
            throw new Error('Blueprint requires tabExecutor');
        }

        this.loop = new BlueprintLoop(
            this.deps.agentRegistry,
            this.deps.eventBus,
            this.deps.tabExecutor
        );
        await this.loop.initialize();
        addLog('[Blueprint] Initialized with BlueprintLoop');
    }

    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            tabExecutor: this.deps.tabExecutor,
            agentRegistry: this.deps.agentRegistry,
            eventBus: this.deps.eventBus,
        };
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        return userInput.trim();
    }

    /**
     * Start: directly launch loop (no coordinator dialogue)
     */
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        if (!this.loop) {
            throw new Error('Blueprint not initialized. Call initialize() first.');
        }

        addLog(`[Blueprint] Starting loop with input: ${userInput.slice(0, 100)}...`);

        // Directly start the loop
        return this.loop.start(userInput, context, sinks);
    }
}
