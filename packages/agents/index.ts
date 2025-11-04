/**
 * @taskagent/agents - Unified Agent Exports
 * 
 * This package contains all agent implementations and runtime utilities.
 * 
 * Usage:
 *   import { globalAgentRegistry, registerAllAgents } from '@taskagent/agents';
 *   import { createStoryPromptAgent } from '@taskagent/agents/story/index.js';
 *   import { runClaudeStream } from '@taskagent/agents/runtime/runClaudeStream.js';
 */

// Re-export Agent Registry (NEW - Phase 3)
export { AgentRegistry, globalAgentRegistry } from './registry/index.js';
export { registerAllAgents } from './registry/registerAgents.js';
export type { Agent, AgentFactory, AgentRegistryEntry } from './registry/index.js';

// Re-export EventBus Adapter (NEW - Phase 3)
export { createEventBusAdapter } from './runtime/eventBusAdapter.js';
export type { EventBusAdapterOptions } from './runtime/eventBusAdapter.js';

// Re-export major agent factories for convenience
export { createStoryPromptAgent } from './story/index.js';
export { createGlossaryPromptAgent } from './glossary/index.js';
export { createUiReviewAgent } from './ui-review/index.js';
export { createLogMonitor, LogMonitor } from './monitor/index.js';

// Re-export runtime utilities
export { runClaudeStream } from './runtime/runClaudeStream.js';
export { buildPromptAgentStart } from './runtime/runPromptAgentStart.js';
export { loadAgentPipelineConfig } from './runtime/agentLoader.js';

// Re-export types
export type { AgentContext, AgentStartContext, AgentStartSinks, ExecutionHandle, PromptAgent } from './runtime/types.js';
