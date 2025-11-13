/**
 * @license
 * Copyright 2025 Google LLC (adapted from gemini-cli)
 * Copyright 2025 taskagent project
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { KeypressHandler, Key } from '../contexts/KeypressProvider.js';
import { useKeypressContext } from '../contexts/KeypressProvider.js';

export type { Key };

/**
 * Hook: subscribe to keypress events
 * 
 * @param onKeypress - Keypress handler function
 * @param options - Configuration options
 * @param options.isActive - Whether to activate (default true)
 */
export function useKeypress(
  onKeypress: KeypressHandler,
  options?: { isActive?: boolean },
) {
  const { subscribe, unsubscribe } = useKeypressContext();
  const isActive = options?.isActive ?? true;

  useEffect(() => {
    if (!isActive) {
      return;
    }

    subscribe(onKeypress);
    
    return () => {
      unsubscribe(onKeypress);
    };
  }, [isActive, onKeypress, subscribe, unsubscribe]);
}
