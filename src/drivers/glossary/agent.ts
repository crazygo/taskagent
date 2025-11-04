import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { loadAgentPipelineConfig } from '../../agent/agentLoader.js';
import { buildPromptAgentStart } from '../../agent/runtime/runPromptAgentStart.js';
import type { AgentStartContext, AgentStartSinks } from '../../agent/types.js';

/**
 * createGlossaryPromptAgent
 *
 * Returns a PromptAgent-like instance built from coordinator.agent.md + agents/*.agent.md.
 * No Glossary class is introduced; Glossary is represented as a data-driven PromptAgent instance.
 */
export async function createGlossaryPromptAgent() {
  const driverDir = path.dirname(fileURLToPath(import.meta.url));
  const { systemPrompt, agents } = await loadAgentPipelineConfig(driverDir, {
    coordinatorFileName: 'coordinator.agent.md',
  });

  const agentId = 'glossary';
  const agentDescription = 'Glossary PromptAgent (coordinator + sub-agents)';

  const coordinator = systemPrompt;

  return {
    id: agentId,
    description: agentDescription,

    // PromptAgent contract (prompt-driven)
    getPrompt(userInput: string) {
      // Use coordinator prompt with {{USER_INPUT}} substitution (parity with prior pipeline)
      return coordinator?.replace(/\{\{USER_INPUT\}\}/g, userInput) ?? userInput;
    },

    // Expose sub-agent definitions to the runtime (SDK `agents` option)
    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
      return agents;
    },

    // Optional hooks – keep minimal until needed
    getTools(): string[] { return []; },
    getModel(): string | undefined { return undefined; },
    start(userInput: string, ctx: AgentStartContext, sinks: AgentStartSinks) {
      const self = {
        getPrompt: (input: string, c: { sourceTabId: string; workspacePath?: string }) => {
          return coordinator?.replace(/\{\{USER_INPUT\}\}/g, input) ?? input;
        },
        getAgentDefinitions: () => agents,
        getModel: () => undefined,
        parseOutput: undefined,
      };
      const starter = buildPromptAgentStart(self);
      return starter(userInput, ctx, sinks);
    },
  };
}
