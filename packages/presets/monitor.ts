/**
 * Monitor Preset - Focused log monitoring
 * 
 * This is a specialized configuration for log monitoring:
 * - Only Monitor tab available
 * - Only monitoring agents registered
 * - Focus mode for maximum log visibility
 * - Starts directly in Monitor tab
 * 
 * Ideal for:
 * - DevOps monitoring
 * - Real-time log analysis
 * - Debugging sessions
 * - CI/CD pipeline monitoring
 * 
 * Usage:
 * ```bash
 * taskagent --preset monitor
 * # or
 * taskagent-monitor
 * ```
 */

import type { PresetConfig } from './types.js';

export const monitorPreset: PresetConfig = {
    name: 'monitor',
    
    // Only Monitor tab
    tabs: [
        'Monitor'
    ],
    
    // Only monitoring-related agents
    agents: [
        'monitor',
        'log-monitor'
    ],
    
    // Start with Monitor tab
    defaultTab: 'Monitor',
    
    // Focus theme for maximum visibility
    theme: {
        primary: 'red',
        mode: 'focus'
    },
    
    description: 'Focused log monitoring with maximized visibility'
};

