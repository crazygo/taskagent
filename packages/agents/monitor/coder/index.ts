import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../../runtime/agentLoader.js';
import { buildPromptAgentStart } from '../../runtime/runPromptAgentStart.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../../runtime/types.js';

const CODER_AGENT_ID = 'coder';
const CODER_DESCRIPTION = 'Backend development executor for implementing features with self-testing';

export async function createAgent(): Promise<RunnableAgent> {
    const agentDir = path.dirname(fileURLToPath(import.meta.url));

    const {
        systemPrompt,
        agents: agentDefinitions,
        allowedTools,
    } = await loadAgentPipelineConfig(agentDir, {
        coordinatorFileName: 'coder.agent.md',
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
        id: CODER_AGENT_ID,
        description: CODER_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => start(userInput, context, sinks),
    };
}
