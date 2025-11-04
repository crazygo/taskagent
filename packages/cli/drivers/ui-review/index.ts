import path from 'path';
import { fileURLToPath } from 'url';

import { Driver, type ViewDriverEntry } from '../types.js';
import StackAgentView from '../../components/StackAgentView.js';
import type { DriverPrepareResult } from '../pipeline.js';
import type { DriverRuntimeContext } from '../types.js';
import type { Message } from '../../types.js';
import { loadAgentPipelineConfig } from '@taskagent/agents/runtime/agentLoader.js';
import { uiReviewDriverEntry as upstreamDriverEntry } from '@taskagent/agents/ui-review/index.js';
import { buildUiReviewSystemPrompt } from './prompt.js';

async function prepareUiReviewInvocation(
    rawInput: string,
    context: DriverRuntimeContext
): Promise<DriverPrepareResult> {
    const userPrompt = rawInput.trim();
    const driverDir = path.dirname(fileURLToPath(import.meta.url));

    const { systemPrompt, allowedTools, disallowedTools } = await loadAgentPipelineConfig(driverDir, {
        systemPromptFactory: buildUiReviewSystemPrompt,
    });

    return {
        prompt: userPrompt,
        overrides: {
            systemPrompt,
            allowedTools,
            disallowedTools,
        },
    };
}

export const uiReviewDriverEntry: ViewDriverEntry = {
    type: 'view',
    id: Driver.UI,
    label: Driver.UI,
    description: 'UI · 输出 ASCII 线框 + 注释',
    requiresSession: true,
    component: StackAgentView,
    useAgentPipeline: true,
    prepare: prepareUiReviewInvocation,
    pipelineOptions: {
        allowedTools: ['Read', 'Grep', 'Glob'],
        disallowedTools: ['Write', 'Edit', 'Bash', 'NotebookEdit', 'FileWrite', 'FileEdit', 'TodoWrite'],
    },
};
