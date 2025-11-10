/**
 * AsyncTask - Shared helper functions
 */

import type { AsyncTaskContext } from './types.js';
import type { AgentStartContext, AgentStartSinks } from '../types.js';
import { addLog } from '@taskagent/shared/logger';

/**
 * Run an agent and collect its output
 */
export async function runAgent(
    agentId: string,
    input: string,
    context: AsyncTaskContext
): Promise<string> {
    const agent = await context.agentRegistry.createAgent(agentId);
    if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
    }

    let output = '';
    const sinks: AgentStartSinks = {
        onText: (chunk: string) => {
            output += chunk;
        },
        onEvent: (e) => {
            context.eventBus.emit(e as any);
        },
        onCompleted: () => {},
        onFailed: (error) => {
            throw new Error(error);
        },
        canUseTool: async (toolName: string, input: Record<string, unknown>) => ({
            behavior: 'allow' as const,
            updatedInput: input,
            updatedPermissions: undefined,
        }),
    };

    const agentContext: AgentStartContext = {
        sourceTabId: context.sourceTabId,
        workspacePath: context.workspacePath,
        parentAgentId: context.parentAgentId,
    };

    const handle = await agent.start(input, agentContext, sinks);
    await handle.completion;

    return output.trim();
}

/**
 * Emit progress event
 */
export function emitProgress(
    eventBus: any,
    agentId: string,
    tabId: string,
    message: string,
    taskId?: string,
    parentAgentId?: string
): void {
    addLog(`[AsyncTask] emitProgress: agentId=${agentId}, tabId=${tabId}, message=${message}`);
    eventBus.emit({
        type: 'task:progress',
        agentId,
        tabId,
        taskId,
        payload: { message },
        timestamp: Date.now(),
        version: '1.0',
        parentAgentId,
    });
}

/**
 * Emit result event
 */
export function emitResult(
    eventBus: any,
    agentId: string,
    tabId: string,
    result: any,
    taskId?: string,
    parentAgentId?: string
): void {
    eventBus.emit({
        type: 'task:result',
        agentId,
        tabId,
        taskId,
        payload: result,
        timestamp: Date.now(),
        version: '1.0',
        parentAgentId,
    });
}
