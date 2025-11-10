/**
 * Default Preset - Full-featured TaskAgent
 * 
 * This is the standard configuration with all features enabled:
 * - All tabs available (Chat, Agent, Story, Glossary, UI Review, Monitor)
 * - All agents registered
 * - Default starts with Chat tab
 * 
 * Usage:
 * ```bash
 * taskagent
 * # or
 * taskagent --preset default
 * ```
 */

import type { PresetConfig } from './types.js';

export const defaultPreset: PresetConfig = {
    name: 'default',
    
    // All tabs available
    tabs: [
        'Chat',
        'Agent', 
        'Story',
        'Glossary',
        'UI-Review',
        'DevHub'
    ],
    
    // All agents registered
    agents: [
        'story',
        'glossary',
        'ui-review',
        'devhub'
    ],
    
    // Default to Chat tab
    defaultTab: 'Chat',
    
    // Standard theme
    theme: {
        primary: 'blue',
        mode: 'standard'
    },
    
    description: 'Full-featured TaskAgent with all tabs and agents'
};

