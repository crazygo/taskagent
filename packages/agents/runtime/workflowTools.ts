import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { TabExecutor } from '../../execution/TabExecutor.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@taskagent/core/event-bus';
import type { ZodTypeAny } from 'zod';

export interface WorkflowSharedDependencies {
    tabExecutor?: TabExecutor;
    agentRegistry?: AgentRegistry;
    eventBus?: EventBus;
    defaultParentAgentId?: string;
}

export interface WorkflowRuntimeContext extends WorkflowSharedDependencies {
    agentId: string;
    workspacePath?: string;
    sourceTabId?: string;
    parentAgentId?: string;
}

export interface WorkflowToolDefinition<TSchema extends Record<string, ZodTypeAny> = Record<string, ZodTypeAny>> {
    name: string;
    description: string;
    parameters: TSchema;
    run: (args: Record<string, unknown>, context: WorkflowRuntimeContext) => Promise<{
        content: { type: 'text'; text: string }[];
        isError?: boolean;
    }>;
}

export interface WorkflowToolsetOptions {
    agentId: string;
    serverName?: string;
    sharedDependencies: WorkflowSharedDependencies;
    tools: WorkflowToolDefinition[];
}

export interface WorkflowServerRequestContext {
    sourceTabId?: string;
    workspacePath?: string;
    parentAgentId?: string;
}

export function createWorkflowToolset(options: WorkflowToolsetOptions) {
    const serverName = options.serverName ?? `${options.agentId}-workflows`;

    const asMcpServer = (
        runtimeCtx: WorkflowServerRequestContext
    ): Record<string, McpServerConfig> | undefined => {
        const baseContext: WorkflowRuntimeContext = {
            agentId: options.agentId,
            tabExecutor: options.sharedDependencies.tabExecutor,
            agentRegistry: options.sharedDependencies.agentRegistry,
            eventBus: options.sharedDependencies.eventBus,
            workspacePath: runtimeCtx.workspacePath,
            sourceTabId: runtimeCtx.sourceTabId,
            parentAgentId: runtimeCtx.parentAgentId ?? options.sharedDependencies.defaultParentAgentId,
        };

        const server = createSdkMcpServer({
            name: serverName,
            tools: options.tools.map((definition) =>
                tool(definition.name, definition.description, definition.parameters, async (args) => {
                    return definition.run(args, baseContext);
                })
            ),
        });

        return { [serverName]: server as McpServerConfig };
    };

    return { asMcpServer };
}
