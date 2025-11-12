import type { RunnableAgent } from '../runtime/types.js';
import type { EventBus } from '@taskagent/core/event-bus';
import { BlueprintAgent } from './BlueprintAgent.js';

export async function createAgent(options?: {
    eventBus?: EventBus;
    tabExecutor?: any;
    messageStore?: any;
    agentRegistry?: any;
}): Promise<RunnableAgent> {
    const agent = new BlueprintAgent({
        eventBus: options?.eventBus,
        tabExecutor: options?.tabExecutor,
        agentRegistry: options?.agentRegistry,
    });

    await agent.initialize();
    return agent;
}
