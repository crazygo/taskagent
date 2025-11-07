/**
 * Unified Agents Export
 *
 * Exposes package-scoped agent factories for consumers.
 */

// Story Agent
export { createAgent as createStoryAgent } from './story/index.js';

// Glossary Agent
export { createAgent as createGlossaryAgent } from './glossary/index.js';

// UI Review Agent
export { createAgent as createUiReviewAgent } from './ui-review/index.js';

// Agent types for external consumers
export type { AgentStartContext, AgentStartSinks, RunnableAgent } from './runtime/types.js';