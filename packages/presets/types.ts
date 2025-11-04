/**
 * Preset Configuration Types
 * 
 * Presets allow different entry points and configurations for TaskAgent.
 * Each preset defines:
 * - Which tabs to load
 * - Which agents to register
 * - Default tab selection
 * - Optional theme configuration
 * 
 * Examples:
 * - default: All features (chat, agent, story, glossary, ui-review, monitor)
 * - monitor: Focus on log monitoring (only monitor tab)
 * - writer: Writing-focused (story, glossary, ui-review)
 */

/**
 * Theme configuration for preset
 */
export interface ThemeConfig {
    /**
     * Primary color for UI elements
     * @example 'blue', 'red', 'green'
     */
    primary?: string;

    /**
     * Display mode
     * - standard: Normal display with all UI elements
     * - focus: Maximized content area, minimal chrome
     */
    mode?: 'standard' | 'focus';
}

/**
 * Preset configuration
 */
export interface PresetConfig {
    /**
     * Unique preset name
     * @example 'default', 'monitor', 'writer'
     */
    name: string;

    /**
     * Tab IDs to load
     * @example ['Chat', 'Story', 'Glossary']
     */
    tabs: string[];

    /**
     * Agent IDs to register
     * @example ['story', 'glossary', 'monitor']
     */
    agents: string[];

    /**
     * Default tab to show on startup
     * @example 'Chat'
     */
    defaultTab: string;

    /**
     * Optional theme configuration
     */
    theme?: ThemeConfig;

    /**
     * Optional description for help text
     */
    description?: string;
}

/**
 * Preset registry type
 */
export type PresetRegistry = Record<string, PresetConfig>;

