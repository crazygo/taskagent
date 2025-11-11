/**
 * Default Tab Configurations
 * 
 * Exports all built-in tab configurations for TaskAgent.
 */

export { chatTabConfig } from './chat.js';
export { agentTabConfig } from './agent.js';
export { desktopTabConfig } from './desktop.js';
export { blueprintTabConfig } from './blueprint.js';
export { glossaryTabConfig } from './glossary.js';
export { uiReviewTabConfig } from './ui-review.js';
export { monitorTabConfig } from './monitor.js';

import { chatTabConfig } from './chat.js';
import { agentTabConfig } from './agent.js';
import { desktopTabConfig } from './desktop.js';
import { blueprintTabConfig } from './blueprint.js';
import { glossaryTabConfig } from './glossary.js';
import { uiReviewTabConfig } from './ui-review.js';
import { monitorTabConfig } from './monitor.js';
import type { TabConfig } from '../types.js';

/**
 * All default tabs in display order
 */
export const defaultTabs: TabConfig[] = [
  chatTabConfig,
  agentTabConfig,
  desktopTabConfig,
  blueprintTabConfig,
  monitorTabConfig,
  glossaryTabConfig,
  uiReviewTabConfig,
];
