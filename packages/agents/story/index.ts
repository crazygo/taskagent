import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';

const STORY_AGENT_ID = 'story';
const STORY_DESCRIPTION = 'Story orchestration agent (plan, review, document user stories)';

export async function createAgent(): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    const getPrompt = (userInput: string, _ctx: AgentContext | AgentStartContext) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const start = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput, ctx),
        getSystemPrompt,
        getAgentDefinitions,
    });

    return {
        id: STORY_AGENT_ID,
        description: STORY_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => start(userInput, context, sinks),
    };
}
