import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import { buildUiReviewSystemPrompt } from './prompt.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, RunnableAgent } from '../runtime/types.js';

/**
 * createUiReviewAgent
 * 
 * Returns a simplified agent for UI Review with custom system prompt.
 * Uses loadAgentPipelineConfig for tool configurations.
 */
export async function createAgent(): Promise<RunnableAgent> {
  const agentDir = path.dirname(fileURLToPath(import.meta.url));
  
  const { systemPrompt: _, allowedTools } = await loadAgentPipelineConfig(agentDir, {
    systemPromptFactory: buildUiReviewSystemPrompt,
  });
  
  const agentId = 'ui-review';
  const agentDescription = 'UI Review Agent (ASCII wireframes + annotations)';

  const getPrompt = (userInput: string, _ctx: AgentContext | AgentStartContext) => userInput.trim();
  const getSystemPrompt = () => ({ type: 'preset', preset: 'claude_code', append: buildUiReviewSystemPrompt() } as const);
  const getAgentDefinitions = () => undefined; // No sub-agents
  const getTools = () => allowedTools ?? [];

  const start = buildPromptAgentStart({
    getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => getPrompt(userInput, ctx),
    getSystemPrompt,
    getAgentDefinitions,
  });

  return {
    id: agentId,
    description: agentDescription,
    getPrompt,
    getAgentDefinitions,
    getTools,
    start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => start(userInput, context, sinks),
  };
}

