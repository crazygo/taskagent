import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { RunnableAgent } from '../runtime/types.js';
import type { TabExecutor } from '../../execution/TabExecutor.js';
import type { EventBus } from '@core/event-bus';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import { FeatureWriterAgent } from './FeatureWriterAgent.js';

export async function createAgent(options?: { 
    tabExecutor?: TabExecutor;
    eventBus?: EventBus;
    agentRegistry?: AgentRegistry;
}): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'feature-writer.agent.md',
    });

    return new FeatureWriterAgent({
        tabExecutor: options?.tabExecutor,
        eventBus: options?.eventBus,
        agentRegistry: options?.agentRegistry,
        systemPrompt,
        agentDefinitions,
        allowedTools,
    });
}
