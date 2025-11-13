/**
 * TabRegistry - Central registry for tab configurations
 * 
 * Manages tab definitions and provides lookup/query methods.
 * Supports dynamic tab generation based on presets.
 */

import type { TabConfig } from './types.js';

export class TabRegistry {
  private tabs: Map<string, TabConfig> = new Map();
  private tabOrder: string[] = [];
  private labelIndex: Map<string, TabConfig> = new Map();
  private slugIndex: Map<string, TabConfig> = new Map();

  /**
   * Register a tab configuration
   * @param config Tab configuration to register
   * @throws Error if tab ID already registered
   */
  register(config: TabConfig): void {
    if (this.tabs.has(config.id)) {
      throw new Error(`Tab with ID "${config.id}" is already registered`);
    }

    this.tabs.set(config.id, config);
    this.tabOrder.push(config.id);

    // Index by lowercase label and slug for quick lookup
    const normalizedLabel = config.label.toLowerCase();
    this.labelIndex.set(normalizedLabel, config);

    const slug = normalizedLabel.replace(/\s+/g, '-');
    this.slugIndex.set(slug, config);
  }

  /**
   * Register multiple tabs at once
   * @param configs Array of tab configurations
   */
  registerMany(configs: TabConfig[]): void {
    for (const config of configs) {
      this.register(config);
    }
  }

  /**
   * Get a tab configuration by ID
   * @param id Tab ID to lookup
   * @returns Tab configuration or undefined if not found
   */
  get(id: string): TabConfig | undefined {
    return this.tabs.get(id);
  }

  /**
   * Get tab configuration by human-readable label (case-insensitive).
   * Supports both original label and slugified form (spaces -> hyphen).
   */
  getByLabel(label: string): TabConfig | undefined {
    if (!label) return undefined;
    const normalized = label.toLowerCase();
    return this.labelIndex.get(normalized) ?? this.slugIndex.get(normalized.replace(/\s+/g, '-'));
  }

  /**
   * Get all registered tabs in registration order
   * @returns Array of tab configurations
   */
  getAll(): TabConfig[] {
    return this.tabOrder.map(id => this.tabs.get(id)!).filter(Boolean);
  }

  /**
   * Get tab IDs in registration order
   * @returns Array of tab IDs
   */
  getTabIds(): string[] {
    return [...this.tabOrder];
  }

  /**
   * Check if a tab is registered
   * @param id Tab ID to check
   * @returns True if tab exists
   */
  has(id: string): boolean {
    return this.tabs.has(id);
  }

  /**
   * Get tabs by type
   * @param type Tab type to filter by
   * @returns Array of matching tab configurations
   */
  getByType(type: TabConfig['type']): TabConfig[] {
    return this.getAll().filter(tab => tab.type === type);
  }

  /**
   * Get tabs by agent ID
   * @param agentId Agent ID to filter by
   * @returns Array of matching tab configurations
   */
  getByAgentId(agentId: string): TabConfig[] {
    return this.getAll().filter(tab => tab.agentId === agentId);
  }

  /**
   * Get tab by CLI flag
   * @param flag CLI flag (e.g., '--blueprint', '--glossary')
   * @returns Tab configuration or undefined if not found
   */
  getByCliFlag(flag: string): TabConfig | undefined {
    return this.getAll().find(tab => tab.cliFlag === flag);
  }

  /**
   * Get tab by slash command
   * @param command Slash command (e.g., '/plan-review-do')
   * @returns Tab configuration or undefined if not found
   */
  getBySlashCommand(command: string): TabConfig | undefined {
    return this.getAll().find(tab => tab.slashCommand === command);
  }

  /**
   * Clear all registered tabs
   */
  clear(): void {
    this.tabs.clear();
    this.tabOrder = [];
    this.labelIndex.clear();
    this.slugIndex.clear();
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTabs: number;
    chatTabs: number;
    agentTabs: number;
    withSessions: number;
    placeholders: number;
  } {
    const all = this.getAll();
    return {
      totalTabs: all.length,
      chatTabs: all.filter(t => t.type === 'chat').length,
      agentTabs: all.filter(t => t.type === 'agent').length,
      withSessions: all.filter(t => t.requiresSession).length,
      placeholders: all.filter(t => t.isPlaceholder).length,
    };
  }
}

/**
 * Create a new TabRegistry instance
 */
export function createTabRegistry(): TabRegistry {
  return new TabRegistry();
}

/**
 * Global tab registry singleton (optional convenience)
 * Applications can create their own registries instead
 */
let globalRegistry: TabRegistry | null = null;

export function getGlobalTabRegistry(): TabRegistry {
  if (!globalRegistry) {
    globalRegistry = new TabRegistry();
  }
  return globalRegistry;
}

export function resetGlobalTabRegistry(): void {
  globalRegistry = null;
}
