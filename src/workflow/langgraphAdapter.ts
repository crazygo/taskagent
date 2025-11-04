import type { PromptAgent } from '../agent/types.js';
import type { StartAgentContext } from './startAgent.js';
import { startAgent } from './startAgent.js';
import { TaskManager } from '../../task-manager.js';

export type NodeFn<S> = (state: S, cfg?: { context?: StartAgentContext; signal?: AbortSignal }) => Promise<Partial<S>>;

export type AgentNodeOptions<S> = {
  // Select input string for the agent from state
  selectInput: (state: S) => string;
  // Map the agent output back onto the graph state (partial update)
  applyResult: (state: S, agentOutput: { text: string }) => Partial<S>;
  timeoutSec?: number;
};

/**
 * Build a LangGraph-compatible node that executes an Agent via TaskManager.
 * The node resolves when the background task completes and returns a partial state update.
 */
export function makeTaskManagerAgentNode<S>(
  taskManager: TaskManager,
  agentFactory: () => Promise<PromptAgent> | PromptAgent,
  opts: AgentNodeOptions<S>
): NodeFn<S> {
  return async (state: S, cfg?: { context?: StartAgentContext; signal?: AbortSignal }) => {
    const agent = await agentFactory();
    const input = opts.selectInput(state);
    const context: StartAgentContext = {
      sourceTabId: cfg?.context?.sourceTabId ?? 'workflow',
      workspacePath: cfg?.context?.workspacePath,
      session: cfg?.context?.session,
      timeoutSec: opts.timeoutSec,
    };
    const { output } = await startAgent(taskManager, agent, input, context, { signal: cfg?.signal });
    return opts.applyResult(state, { text: output });
  };
}
