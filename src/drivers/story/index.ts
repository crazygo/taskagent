import path from 'path';
import { fileURLToPath } from 'url';

import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverPrepareResult } from '../pipeline.js';
import type { DriverRuntimeContext } from '../types.js';
import { loadAgentPipelineConfig } from '../../agent/agentLoader.js';

// This is the core loader and preparation function for the Story driver.
async function prepareStoryInvocation(
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

export const storyDriverEntry: ViewDriverEntry = {
    type: 'view',
    id: Driver.STORY,
    label: Driver.STORY,
    description: 'Story Orchestration · 整理、审阅并沉淀到 Markdown',
    requiresSession: true,
    component: StackAgentView,
    useAgentPipeline: true,
    prepare: prepareStoryInvocation,
    pipelineOptions: {
        disallowedTools: ['Bash'], // High-level constraints
    },
};
