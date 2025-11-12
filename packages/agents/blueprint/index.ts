import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { RunnableAgent } from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { BlueprintAgent } from './BlueprintAgent.js';

export async function createAgent(options?: {
    eventBus?: EventBus;
    tabExecutor?: any;
    messageStore?: any;
    agentRegistry?: any;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    return new BlueprintAgent({
        eventBus: options?.eventBus,
        tabExecutor: options?.tabExecutor,
        agentRegistry: options?.agentRegistry,
        systemPrompt,
        agentDefinitions,
        allowedTools,
    });
}
