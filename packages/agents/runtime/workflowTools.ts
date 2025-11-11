import { tool } from '@anthropic-ai/claude-agent-sdk';
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
    sharedDependencies: WorkflowSharedDependencies;
    tool: WorkflowToolDefinition;
}

export interface WorkflowServerRequestContext {
    sourceTabId?: string;
    workspacePath?: string;
    parentAgentId?: string;
}

export function createWorkflowToolset(options: WorkflowToolsetOptions) {
    const asMcpTool = (runtimeCtx: WorkflowServerRequestContext) => {
        const baseContext: WorkflowRuntimeContext = {
            agentId: options.agentId,
            tabExecutor: options.sharedDependencies.tabExecutor,
            agentRegistry: options.sharedDependencies.agentRegistry,
            eventBus: options.sharedDependencies.eventBus,
            workspacePath: runtimeCtx.workspacePath,
            sourceTabId: runtimeCtx.sourceTabId,
            parentAgentId: runtimeCtx.parentAgentId ?? options.sharedDependencies.defaultParentAgentId,
        };

        const definition = options.tool;

        return tool(definition.name, definition.description, definition.parameters, async (args) => {
            return definition.run(args, baseContext);
        });
    };

    return { asMcpTool };
}
