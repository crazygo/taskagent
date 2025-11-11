import path from 'path';
import { fileURLToPath } from 'url';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import type {
    AgentContext,
    AgentStartContext,
    AgentStartSinks,
    ExecutionHandle,
    RunnableAgent,
} from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { createWorkflowToolset } from '../runtime/workflowTools.js';
import { defineRefineFeatureSpecWorkflow } from './workflows.js';

const BLUEPRINT_AGENT_ID = 'blueprint';
const BLUEPRINT_DESCRIPTION = 'Blueprint coordinator agent (dialog + workflow orchestration)';

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

    const getPrompt = (userInput: string) => userInput.trim();
    const getSystemPrompt = () => systemPrompt;
    const getAgentDefinitions = () => agentDefinitions;
    const getTools = () => allowedTools ?? [];

    const workflowToolset = createWorkflowToolset({
        agentId: BLUEPRINT_AGENT_ID,
        serverName: 'blueprint-tools',
        sharedDependencies: {
            tabExecutor: options?.tabExecutor,
            agentRegistry: options?.agentRegistry,
            eventBus: options?.eventBus,
            defaultParentAgentId: BLUEPRINT_AGENT_ID,
        },
        tools: [defineRefineFeatureSpecWorkflow()],
    });

    const startPrompt = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpServers: (ctx) =>
            workflowToolset.asMcpServer({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.rawContext?.parentAgentId ?? BLUEPRINT_AGENT_ID,
            }),
    });

    return {
        id: BLUEPRINT_AGENT_ID,
        description: BLUEPRINT_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
        asMcpServer: (ctx) =>
            workflowToolset.asMcpServer({
                sourceTabId: ctx.sourceTabId,
                workspacePath: ctx.workspacePath,
                parentAgentId: ctx.parentAgentId ?? BLUEPRINT_AGENT_ID,
            }),
        start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
            // Minimal start: no event-bus mirroring to avoid duplicate messages
            const enhancedContext: AgentStartContext = {
                ...context,
                tabExecutor: options?.tabExecutor,
            } as AgentStartContext & AgentContext & { tabExecutor?: any };
            return startPrompt(userInput, enhancedContext, sinks);
        },
    };
}
