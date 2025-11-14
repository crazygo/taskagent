import type { RunnableAgent } from '../runtime/types.js';

import type { EventBus } from '@core/event-bus';
import { BlueprintLoop } from './BlueprintLoop.js';

export async function createAgent(options?: {
    eventBus?: EventBus;
    tabExecutor?: any;
    messageStore?: any;
    agentRegistry?: any;
}): Promise<RunnableAgent> {
    const loop = new BlueprintLoop(
        options?.agentRegistry,
        options?.eventBus!,
        options?.tabExecutor
    );
    await loop.initialize();
    return loop;
}
