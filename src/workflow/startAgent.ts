import type { PromptAgent } from '../agent/types.js';
import type { Task } from '../../task-manager.js';
import { TaskManager } from '../../task-manager.js';

export type StartAgentContext = {
  sourceTabId: string;
  workspacePath?: string;
  session?: { id: string; initialized: boolean };
  timeoutSec?: number;
};

export type StartAgentOptions = {
  signal?: AbortSignal;
};

export type AgentRunResult = {
  task: Task;
  output: string;
};

/**
 * Start an agent via TaskManager and await completion.
 * - Creates a background task (so it is visible in Task list)
 * - Propagates AbortSignal to cancel the task
 * - Resolves with the final Task snapshot and output
 */
export async function startAgent(
  taskManager: TaskManager,
  agent: PromptAgent,
  userInput: string,
  context: StartAgentContext,
  options: StartAgentOptions = {}
): Promise<AgentRunResult> {
  const { task } = taskManager.startBackground(agent, userInput, context);

  const onAbort = () => {
    try { taskManager.cancelTask(task.id); } catch {}
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const completed = await taskManager.waitTask(task.id);
    return { task: completed, output: completed.output };
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
