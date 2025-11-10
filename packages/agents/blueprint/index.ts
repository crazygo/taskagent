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
import { createBlueprintMcpServer } from './tools.js';
import { addLog } from '@taskagent/shared/logger';

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

    const startPrompt = buildPromptAgentStart({
        getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput),
        getSystemPrompt,
        getAgentDefinitions,
        getMcpServers: (ctx) => {
            if (!options?.tabExecutor) {
                return undefined;
            }
            return {
                'blueprint-tools': createBlueprintMcpServer({
                    tabExecutor: options.tabExecutor,
                    workspacePath: ctx.workspacePath,
                    tabId: ctx.sourceTabId,
                    agentRegistry: options.agentRegistry,
                    eventBus: options.eventBus,
                }),
            };
        },
    });

    return {
        id: BLUEPRINT_AGENT_ID,
        description: BLUEPRINT_DESCRIPTION,
        getPrompt,
        getAgentDefinitions,
        getTools,
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
