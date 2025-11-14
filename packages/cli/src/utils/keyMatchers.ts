/**
 * @license
 * Copyright 2025 Google LLC (adapted from gemini-cli)
 * Copyright 2025 taskagent project
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Key } from '../contexts/KeypressProvider.js';
import type { KeyBinding, KeyBindingConfig } from '../config/keyBindings.js';
import { Command, defaultKeyBindings } from '../config/keyBindings.js';

/**
 * Match a single KeyBinding against a key press
 */
function matchKeyBinding(binding: KeyBinding, key: Key): boolean {
  // 1. Check key name or sequence
  let keyMatches = false;
  
  if (binding.key !== undefined) {
    keyMatches = binding.key === key.name;
  } else if (binding.sequence !== undefined) {
    keyMatches = binding.sequence === key.sequence;
  } else {
    return false; // Invalid binding
  }
  
  if (!keyMatches) return false;
  
  // 2. Check modifiers (tri-state logic)
  if (binding.ctrl !== undefined && key.ctrl !== binding.ctrl) {
    return false;
  }
  
  if (binding.shift !== undefined && key.shift !== binding.shift) {
    return false;
  }
  
  if (binding.meta !== undefined && key.meta !== binding.meta) {
    return false;
  }
  
  if (binding.paste !== undefined && key.paste !== binding.paste) {
    return false;
  }
  
  return true;
}

/**
 * Check if a key matches a command
 */
function matchCommand(
  command: Command,
  key: Key,
  config: KeyBindingConfig = defaultKeyBindings,
): boolean {
  const bindings = config[command];
  return bindings.some((binding: KeyBinding) => matchKeyBinding(binding, key));
}

/**
 * Key matcher function type
 */
type KeyMatcher = (key: Key) => boolean;

/**
 * All command matchers
 */
export type KeyMatchers = {
  readonly [C in Command]: KeyMatcher;
};

/**
 * Create matcher lookup table
 */
export function createKeyMatchers(
  config: KeyBindingConfig = defaultKeyBindings,
): KeyMatchers {
  const matchers = {} as { [C in Command]: KeyMatcher };
  
  const commandValues = Object.values(Command) as Command[];
  for (const command of commandValues) {
    matchers[command] = (key: Key) => matchCommand(command, key, config);
  }
  
  return matchers as KeyMatchers;
}

/**
 * Default matchers (singleton)
 */
export const keyMatchers: KeyMatchers = createKeyMatchers();

// Export Command for convenience
export { Command };
