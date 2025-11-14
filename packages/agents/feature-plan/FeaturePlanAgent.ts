import { PromptAgent, type AgentContext, type AgentToolContext, type RunnableAgent, type AgentStartContext, type AgentStartSinks, type ExecutionHandle } from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentRegistry } from '../registry/AgentRegistry.js';
import type { EventBus } from '@core/event-bus';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const FEATURE_PLAN_AGENT_ID = 'feature-plan';
const FEATURE_PLAN_DESCRIPTION = 'Feature Plan - Analyze requirements and detect conflicts';

interface FeaturePlanAgentDeps {
    tabExecutor?: any;
    systemPrompt?: any;
    agentDefinitions?: Record<string, AgentDefinition>;
    allowedTools?: string[];
    eventBus?: EventBus;
    agentRegistry?: AgentRegistry;
}

export class FeaturePlanAgent extends PromptAgent implements RunnableAgent {
    readonly id = FEATURE_PLAN_AGENT_ID;
    readonly description = FEATURE_PLAN_DESCRIPTION;

    constructor(private deps: FeaturePlanAgentDeps) {
        super();
    }

    protected buildToolContext(): AgentToolContext {
        return {
            ...this.runtimeContext,
            tabExecutor: this.deps.tabExecutor,
            eventBus: this.deps.eventBus,
            agentRegistry: this.deps.agentRegistry,
        };
    }

    getPrompt(userInput: string, _context: AgentContext): string {
        return userInput.trim();
    }

    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
        return this.deps.agentDefinitions;
    }

    getTools(): string[] {
        return this.deps.allowedTools ?? [];
    }

    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.setRuntimeContext({
            sourceTabId: context.sourceTabId,
            workspacePath: context.workspacePath,
            parentAgentId: context.parentAgentId ?? FEATURE_PLAN_AGENT_ID,
        });
        
        const startFn = buildPromptAgentStart({
            getPrompt: (userInput: string) => this.getPrompt(userInput, context),
            getSystemPrompt: () => this.deps.systemPrompt,
            getAgentDefinitions: () => this.getAgentDefinitions(),
            getMcpTools: () => {
                const tool = this.asMcpTool();
                return tool ? { [this.id]: tool } : undefined;
            },
        });
        
        return startFn(userInput, context, sinks);
    }
}
