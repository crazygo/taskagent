import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type { RunnableAgent } from '../runtime/types.js';
import type { TabExecutor } from '../../execution/TabExecutor.js';
import { WriterAgent } from './WriterAgent.js';

export async function createAgent(options?: { tabExecutor?: TabExecutor }): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'writer.agent.md',
    });

    return new WriterAgent({
        tabExecutor: options?.tabExecutor,
        systemPrompt,
        agentDefinitions,
        allowedTools,
    });
}
