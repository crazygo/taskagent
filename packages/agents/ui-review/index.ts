import path from 'path';
import { fileURLToPath } from 'url';
import { loadAgentPipelineConfig } from '../runtime/agentLoader.js';
import { buildUiReviewSystemPrompt } from './prompt.js';
import type { AgentStartContext, AgentStartSinks } from '../runtime/types.js';

/**
 * createUiReviewAgent
 * 
 * Returns a simplified agent for UI Review with custom system prompt.
 * Uses loadAgentPipelineConfig for tool configurations.
 */
export async function createAgent() {
  const agentDir = path.dirname(fileURLToPath(import.meta.url));
  
  const { systemPrompt: _, allowedTools, disallowedTools } = await loadAgentPipelineConfig(agentDir, {
    systemPromptFactory: buildUiReviewSystemPrompt,
  });
  
  const systemPrompt = buildUiReviewSystemPrompt();
  const agentId = 'ui-review';
  const agentDescription = 'UI Review Agent (ASCII wireframes + annotations)';

  return {
    id: agentId,
    description: agentDescription,

    // Agent contract
    getPrompt(userInput: string) {
      return userInput.trim();
    },

    getSystemPrompt() {
      return { type: 'preset', preset: 'claude_code', append: systemPrompt } as const;
    },

    getAgentDefinitions() {
      return undefined; // No sub-agents
    },

    getTools(): string[] {
      return allowedTools || [];
    },
    
    getModel(): string | undefined {
      return undefined;
    },

    // Minimal start implementation (not used in current pipeline flow)
    start(userInput: string, ctx: AgentStartContext, sinks: AgentStartSinks) {
      throw new Error('UI Review Agent uses pipeline flow, not direct start()');
    },
  };
}

