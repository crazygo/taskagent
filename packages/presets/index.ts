/**
 * Presets - Entry point configurations for TaskAgent
 * 
 * This package provides pre-configured entry points for different use cases:
 * - default: Full-featured with all tabs and agents
 * 
 * Usage:
 * ```typescript
 * import { getPreset, PRESETS } from '@taskagent/presets';
 * 
 * const preset = getPreset('default');
 * // or
 * const preset = getPreset(process.env.TASKAGENT_PRESET);
 * ```
 */

import { defaultPreset } from './default.js';
import type { PresetConfig, PresetRegistry } from './types.js';

/**
 * Registry of all available presets
 */
export const PRESETS: PresetRegistry = {
    default: defaultPreset,
};

/**
 * Get a preset by name
 * @param name Preset name (e.g., 'default')
 * @returns Preset configuration or undefined if not found
 */
export function getPreset(name: string): PresetConfig | undefined {
    return PRESETS[name];
}

/**
 * Get preset or fallback to default
 * @param name Preset name
 * @returns Preset configuration (always returns a value)
 */
export function getPresetOrDefault(name: string = 'default'): PresetConfig {
    const preset = PRESETS[name];
    return (preset ?? PRESETS.default)!;
}

/**
 * Get list of available preset names
 */
export function getAvailablePresets(): string[] {
    return Object.keys(PRESETS);
}

// Re-export everything
export { defaultPreset } from './default.js';
export type { PresetConfig, ThemeConfig, PresetRegistry } from './types.js';

