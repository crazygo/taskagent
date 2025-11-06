/**
 * @taskagent/tabs - Tab configuration and registry
 * 
 * Provides tab definitions, registry, and configuration management.
 */

export type { TabConfig, TabType, ExecutionMode } from './types.js';
export { TabRegistry, createTabRegistry, getGlobalTabRegistry, resetGlobalTabRegistry } from './TabRegistry.js';

