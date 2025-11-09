/**
 * Agent Registry - Export
 */

import { AgentRegistry as AgentRegistryClass, globalAgentRegistry as _globalAgentRegistry } from './AgentRegistry.js';

export { AgentRegistryClass as AgentRegistry, _globalAgentRegistry as globalAgentRegistry };
export type { Agent, AgentFactory, AgentRegistryEntry } from './AgentRegistry.js';
export { registerAllAgents } from './registerAgents.js';

// Helper to get global registry
export function getGlobalAgentRegistry() {
    return _globalAgentRegistry;
}

