import { emitResult } from '../runtime/async-task/helpers.js';
import type { AsyncTaskContext, AsyncTaskHandle } from '../runtime/async-task/types.js';

interface BackgroundTaskRunner {
    (params: { input: string; context: AsyncTaskContext; taskId: string; isCancelled: () => boolean }): Promise<void>;
}

export function launchBackgroundTask(
    input: string,
    context: AsyncTaskContext,
    runner: BackgroundTaskRunner
): AsyncTaskHandle {
    const taskId = `blueprint-task-${Date.now()}`;
    let cancelled = false;

    const completion = (async () => {
        try {
            await runner({
                input,
                context,
                taskId,
                isCancelled: () => cancelled,
            });
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const agentId = 'blueprint';
            const tabId = context.sourceTabId || 'Blueprint';
            emitResult(context.eventBus, agentId, tabId, { error: message }, taskId, context.parentAgentId);
            return false;
        }
    })();

    return {
        taskId,
        cancel: () => {
            cancelled = true;
        },
        completion,
    };
}
