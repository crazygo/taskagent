/**
 * Tab Configuration Types
 *
 * Defines the structure and behavior of tabs in TaskAgent.
 * Each tab is bound to an agent and has configurable execution settings.
 *
 * IMPORTANT: This package contains ONLY data definitions, no UI dependencies.
 * The CLI layer is responsible for mapping tab configs to UI components.
 */

/**
 * Tab types determine the behavior and UI rendering
 */
export type TabType = 'chat' | 'agent';

/**
 * Execution mode determines how the agent runs
 * - foreground: Main screen, shared session, full interaction
 * - background: Small area, forked session, independent execution
 */
export type ExecutionMode = 'foreground' | 'background';

/**
 * Tab configuration interface
 * Each tab represents a view in the application with an associated agent
 */
export interface TabConfig {
  /**
   * Unique identifier for this tab
   * @example 'Chat', 'Story', 'Glossary'
   */
  id: string;

  /**
   * Display label shown in the tab bar
   * @example 'Chat', 'Story', 'UI Review'
   */
  label: string;

  /**
   * Tab type determines rendering and behavior
   * - 'chat': Simple chat interface with Vercel AI SDK
   * - 'agent': Agent-driven interface with Claude Agent SDK
   */
  type: TabType;

  /**
   * Agent ID to use for this tab (fixed binding)
   * Agent will be looked up from AgentRegistry
   * @example 'story', 'glossary', 'ui-review', 'log-monitor'
   */
  agentId: string | null;

  /**
   * Description shown in help/tooltips
   */
  description: string;

  /**
   * Whether this tab requires a session
   * If true, session must be initialized before use
   */
  requiresSession: boolean;

  /**
   * Execution mode for agent runs
   * @default 'foreground'
   */
  executionMode?: ExecutionMode;

  /**
   * Maximum frozen messages to keep for this tab when invisible
   * When tab is not active, message history is trimmed to this limit
   * @default 20
   */
  maxFrozenMessages?: number;

  /**
   * Whether this is a placeholder tab (not fully implemented)
   * @default false
   */
  isPlaceholder?: boolean;

  /**
   * CLI flag to activate this tab (e.g., '--build-specs', '--glossary')
   */
  cliFlag?: string;

  /**
   * Slash command to invoke this tab's agent (e.g., '/plan-review-do')
   */
  slashCommand?: string;
}
