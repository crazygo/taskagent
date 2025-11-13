/**
 * @license
 * Copyright 2025 Google LLC (adapted from gemini-cli)
 * Copyright 2025 taskagent project
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Modified for taskagent project:
 * - Simplified Kitty protocol parsing (removed)
 * - Added bracketed paste detection
 * - Using readline for base keypress handling
 */

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { useStdin } from 'ink';
import readline from 'node:readline';

// Bracketed paste protocol markers
const PASTE_MODE_PREFIX = '\x1B[200~';
const PASTE_MODE_SUFFIX = '\x1B[201~';

/**
 * Normalized key event
 */
export interface Key {
  /** Key name, e.g., 'a', 'return', 'left' */
  name: string;
  
  /** Whether Ctrl is pressed */
  ctrl: boolean;
  
  /** Whether Meta/Command/Alt is pressed */
  meta: boolean;
  
  /** Whether Shift is pressed */
  shift: boolean;
  
  /** Whether this is a paste event */
  paste: boolean;
  
  /** Raw key sequence */
  sequence: string;
}

/**
 * Keypress event handler
 */
export type KeypressHandler = (key: Key) => void;

/**
 * Context value type
 */
interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
}

/**
 * Context definition
 */
const KeypressContext = createContext<KeypressContextValue | undefined>(
  undefined,
);

/**
 * Hook: access KeypressContext
 */
export function useKeypressContext() {
  const context = useContext(KeypressContext);
  if (!context) {
    throw new Error(
      'useKeypressContext must be used within a KeypressProvider',
    );
  }
  return context;
}

/**
 * Provider component
 */
export function KeypressProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { stdin, setRawMode } = useStdin();
  const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;
  
  // Paste state
  const isPastingRef = useRef(false);
  const pasteBufferRef = useRef('');

  /**
   * Broadcast key event to all subscribers
   */
  const broadcast = useCallback(
    (key: Key) => {
      subscribers.forEach(handler => handler(key));
    },
    [subscribers],
  );

  /**
   * Subscribe to keypress events
   */
  const subscribe = useCallback(
    (handler: KeypressHandler) => {
      subscribers.add(handler);
    },
    [subscribers],
  );

  /**
   * Unsubscribe from keypress events
   */
  const unsubscribe = useCallback(
    (handler: KeypressHandler) => {
      subscribers.delete(handler);
    },
    [subscribers],
  );

  useEffect(() => {
    // Enable raw mode
    const wasRaw = stdin.isRaw;
    if (!wasRaw) {
      setRawMode(true);
    }

    // Enable readline keypress events
    readline.emitKeypressEvents(stdin);

    /**
     * Handle raw data stream (for paste detection)
     */
    const handleRawData = (chunk: Buffer) => {
      const str = chunk.toString();

      // Detect paste start
      if (str.includes(PASTE_MODE_PREFIX)) {
        isPastingRef.current = true;
        pasteBufferRef.current = '';
        return;
      }

      // Detect paste end
      if (str.includes(PASTE_MODE_SUFFIX)) {
        isPastingRef.current = false;

        // Broadcast complete paste content
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBufferRef.current,
        });

        pasteBufferRef.current = '';
        return;
      }

      // During paste, accumulate content
      if (isPastingRef.current) {
        pasteBufferRef.current += str;
      }
    };

    /**
     * Handle readline parsed keypress events
     */
    const handleKeypress = (str: string, key: any) => {
      // Keys during paste are handled by handleRawData
      // CRITICAL: Ignore all keypress events during paste to avoid duplication
      if (isPastingRef.current) {
        return;
      }

      // Normalize key object
      const normalizedKey: Key = {
        name: key.name || '',
        ctrl: key.ctrl || false,
        meta: key.meta || false,
        shift: key.shift || false,
        paste: false,
        sequence: key.sequence || str || '',
      };

      broadcast(normalizedKey);
    };

    // Register event listeners
    stdin.on('data', handleRawData);
    stdin.on('keypress', handleKeypress);

    // Cleanup function
    return () => {
      stdin.off('data', handleRawData);
      stdin.off('keypress', handleKeypress);
      
      if (!wasRaw) {
        setRawMode(false);
      }
    };
  }, [stdin, setRawMode, broadcast]);

  return (
    <KeypressContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </KeypressContext.Provider>
  );
}
