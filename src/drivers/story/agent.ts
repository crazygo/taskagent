import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { loadAgentPipelineConfig } from '../../agent/agentLoader.js';
import { buildPromptAgentStart } from '../../agent/runtime/runPromptAgentStart.js';
import type { AgentStartContext, AgentStartSinks } from '../../agent/types.js';

/**
 * createStoryPromptAgent
 * 
 * Returns a PromptAgent-like instance built from coordinator.agent.md + agents/*.agent.md.
 * No custom Story class is created; Story is represented as a data-driven PromptAgent instance.
 */
export async function createStoryPromptAgent() {
  const driverDir = path.dirname(fileURLToPath(import.meta.url));
  const { systemPrompt, agents } = await loadAgentPipelineConfig(driverDir, {
    coordinatorFileName: 'coordinator.agent.md',
  });

  const agentId = 'story';
  const agentDescription = 'Story PromptAgent (coordinator + sub-agents)';

  const coordinator = systemPrompt;

  return {
    id: agentId,
    description: agentDescription,

    // PromptAgent contract (prompt-driven)
    getPrompt(userInput: string) {
      // Embed user input into coordinator prompt (matches previous pipeline semantics)
      return coordinator?.replace(/\{\{USER_INPUT\}\}/g, userInput) ?? userInput;
    },

    // Expose sub-agent definitions to the runtime (SDK `agents` option)
    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
      return agents;
    },

    // Optional hooks – kept minimal for now
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
