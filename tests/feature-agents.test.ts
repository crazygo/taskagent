import { describe, it, expect, beforeAll } from 'vitest';

describe('Feature Architecture Updates', () => {
  let agentRegistry: any;
  let registerAllAgents: any;
  
  beforeAll(async () => {
    // Dynamically import to avoid path alias issues
    const registryModule = await import('../packages/agents/registry/AgentRegistry.js');
    const registerModule = await import('../packages/agents/registry/registerAgents.js');
    
    agentRegistry = registryModule.globalAgentRegistry;
    registerAllAgents = registerModule.registerAllAgents;
    
    // Register all agents once
    registerAllAgents();
  });

  it('should register feature-plan agent', () => {
    expect(agentRegistry.has('feature-plan')).toBe(true);
  });

  it('should register feature-edit agent (not feature-writer)', () => {
    expect(agentRegistry.has('feature-edit')).toBe(true);
    expect(agentRegistry.has('feature-writer')).toBe(false);
  });

  it('should have blueprint agent configured correctly', () => {
    expect(agentRegistry.has('blueprint')).toBe(true);
  });

  it('should have all required agents for the new architecture', () => {
    const requiredAgents = ['feature-plan', 'feature-edit', 'blueprint'];
    const allIds = agentRegistry.getAllIds();
    
    for (const agentId of requiredAgents) {
      expect(allIds).toContain(agentId);
    }
    
    // Verify feature-writer is removed
    expect(allIds).not.toContain('feature-writer');
  });
});
