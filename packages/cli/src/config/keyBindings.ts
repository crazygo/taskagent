/**
 * @license
 * Copyright 2025 Google LLC (adapted from gemini-cli)
 * Copyright 2025 taskagent project
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Command enum: defines all keyboard shortcut semantics
 */
export enum Command {
  // Tab switching
  SWITCH_TAB_NEXT = 'switchTabNext',
  SWITCH_TAB_PREV = 'switchTabPrev',
  
  // Text input
  SUBMIT = 'submit',
  NEWLINE = 'newline',
  
  // Editing operations
  DELETE_WORD_BACKWARD = 'deleteWordBackward',
  CLEAR_INPUT = 'clearInput',
  
  // Navigation
  HISTORY_UP = 'historyUp',
  HISTORY_DOWN = 'historyDown',
  
  // Exit
  QUIT = 'quit',
}

/**
 * KeyBinding interface: describes a single key combination
 */
export interface KeyBinding {
  /** Key name, e.g., 'n', 'return', 'tab' */
  key?: string;
  
  /** Raw sequence, e.g., '\x18' (Ctrl+X) */
  sequence?: string;
  
  /** Ctrl key: true=must press, false=must not press, undefined=ignore */
  ctrl?: boolean;
  
  /** Shift key */
  shift?: boolean;
  
  /** Meta/Command/Alt key */
  meta?: boolean;
  
  /** Whether it's a paste event */
  paste?: boolean;
}

/**
 * Complete key binding configuration
 */
export type KeyBindingConfig = {
  readonly [C in Command]: readonly KeyBinding[];
};

/**
 * Default keyboard shortcuts mapping
 */
export const defaultKeyBindings: KeyBindingConfig = {
  // Tab switching
  [Command.SWITCH_TAB_NEXT]: [
    { key: 'n', ctrl: true },
  ],
  [Command.SWITCH_TAB_PREV]: [
    { key: 'p', ctrl: true },
  ],
  
  // Submit: only Enter (excluding Shift/Ctrl/Meta/Paste)
  [Command.SUBMIT]: [
    {
      key: 'return',
      ctrl: false,
      shift: false,
      meta: false,
      paste: false,
    },
  ],
  
  // Newline: Shift+Enter or Ctrl+J
  [Command.NEWLINE]: [
    { key: 'return', shift: true },
    { key: 'j', ctrl: true },
  ],
  
  // Delete word
  [Command.DELETE_WORD_BACKWARD]: [
    { key: 'backspace', ctrl: true },
    { key: 'backspace', meta: true },
  ],
  
  // Clear input
  [Command.CLEAR_INPUT]: [
    { key: 'u', ctrl: true },
  ],
  
  // History navigation
  [Command.HISTORY_UP]: [
    { key: 'up' },
  ],
  [Command.HISTORY_DOWN]: [
    { key: 'down' },
  ],
  
  // Quit
  [Command.QUIT]: [
    { key: 'c', ctrl: true },
    { key: 'd', ctrl: true },
  ],
};
