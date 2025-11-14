/**
 * Unified Agents Export
 *
 * Exposes package-scoped agent factories for consumers.
 */

// Blueprint Agent (formerly Story)
export { createAgent as createBlueprintAgent } from './blueprint/index.js';
export { createAgent as createFeatureEditAgent } from './feature-edit/index.js';
export { createAgent as createFeaturePlanAgent } from './feature-plan/index.js';
export { createAgent as createCoderAgent } from './coder/index.js';
export { createAgent as createReviewAgent } from './review/index.js';
export { createAgent as createGlossaryAgent } from './glossary/index.js';
export { createAgent as createDevHubAgent } from './devhub/index.js';

// Agent types for external consumers
export type { AgentStartContext, AgentStartSinks, RunnableAgent } from './runtime/types.js';
