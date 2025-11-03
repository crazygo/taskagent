import path from 'path';
import { fileURLToPath } from 'url';

import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverPrepareResult } from '../pipeline.js';
import type { DriverRuntimeContext } from '../types.js';
import { loadAgentPipelineConfig } from '../../agent/agentLoader.js';

async function prepareGlossaryInvocation(
    rawInput: string,
    context: DriverRuntimeContext
): Promise<DriverPrepareResult> {
    const userPrompt = rawInput.trim();
    const driverDir = path.dirname(fileURLToPath(import.meta.url));

    const { systemPrompt, agents, allowedTools, disallowedTools } = await loadAgentPipelineConfig(driverDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    return {
        prompt: userPrompt,
        overrides: {
            systemPrompt,
            agents,
            allowedTools,
            disallowedTools,
        },
    };
}

export const glossaryDriverEntry: ViewDriverEntry = {
    type: 'view',
    id: Driver.GLOSSARY,
    label: Driver.GLOSSARY,
    description: 'Manage and understand project terminology',
    requiresSession: true,
    component: StackAgentView,
    useAgentPipeline: true,
    prepare: prepareGlossaryInvocation,
    pipelineOptions: {
        disallowedTools: ['Bash'],
    },
};
