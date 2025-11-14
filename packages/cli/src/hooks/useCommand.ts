/**
 * @license
 * Copyright 2025 taskagent project
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useKeypressContext, type Key } from '../contexts/KeypressProvider.js';
import { Command } from '../config/keyBindings.js';
import { createKeyMatchers } from '../utils/keyMatchers.js';

/**
 * Hook: subscribe to specific command shortcuts
 * 
 * Example:
 *   useCommand(Command.SUBMIT, () => onSubmit(value));
 *   useCommand(Command.SWITCH_TAB_NEXT, switchToNextTab, { isActive: isFocused });
 * 
 * @param command - Command to listen for
 * @param handler - Callback when command is triggered
 * @param options - Configuration options
 */
export function useCommand(
  command: Command,
  handler: () => void,
  options?: { isActive?: boolean },
) {
  const { subscribe, unsubscribe } = useKeypressContext();
  const isActive = options?.isActive ?? true;
  
  // Create matchers (cached)
  const matchers = useMemo(() => createKeyMatchers(), []);

  // Wrap callback: check if key matches command
  const callback = useCallback(
    (key: Key) => {
      if (matchers[command](key)) {
        handler();
      }
    },
    [command, handler, matchers],
  );

  useEffect(() => {
    if (!isActive) {
      return;
    }

    subscribe(callback);
    
    return () => {
      unsubscribe(callback);
    };
  }, [isActive, callback, subscribe, unsubscribe]);
}
