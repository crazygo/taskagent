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
import { addLog } from '@taskagent/shared/logger';

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
  const isPastingRef = useRef(false); // any paste (heuristic or bracket)
  const isBracketPasteRef = useRef(false); // true only during bracketed paste
  const pasteBufferRef = useRef('');
  // Global submit guard: suppress Enter during and shortly after paste
  const submitGuardUntilRef = useRef(0);
  // Suppress exactly one trailing Enter after paste end
  const suppressReturnOnceRef = useRef(false);

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
    // Enable raw mode and bracketed paste mode
    const wasRaw = stdin.isRaw;
    if (!wasRaw) {
      setRawMode(true);
      // Enable bracketed paste mode by sending escape sequence on stdout
      // This makes the terminal wrap pasted content in \x1B[200~ ... \x1B[201~
      process.stdout.write('\x1B[?2004h');
      addLog('[KeypressProvider] Enabled bracketed paste mode');
    }


    /**
     * Handle raw data stream (for paste detection)
     */
    const handleRawData = (chunk: Buffer) => {
      const str = chunk.toString();

      // Detect paste start
      if (str.includes(PASTE_MODE_PREFIX)) {
        addLog('[KeypressProvider] PASTE START detected');
        isPastingRef.current = true;
        isBracketPasteRef.current = true;
        pasteBufferRef.current = '';
        // open submit guard during bracketed paste
        submitGuardUntilRef.current = Date.now() + 1500;
        // remove marker and keep rest
        const withoutPrefix = str.replace(PASTE_MODE_PREFIX, '');
        if (withoutPrefix) {
          pasteBufferRef.current += withoutPrefix;
        }
        return;
      }

      // Detect paste end
      if (str.includes(PASTE_MODE_SUFFIX)) {
        // append content before suffix
        const idx = str.indexOf(PASTE_MODE_SUFFIX);
        if (idx > 0) pasteBufferRef.current += str.slice(0, idx);
        addLog(`[KeypressProvider] PASTE END detected, length: ${pasteBufferRef.current.length}`);
        isPastingRef.current = false;
        isBracketPasteRef.current = false;
        // keep guard briefly after end to swallow trailing Enter
        submitGuardUntilRef.current = Date.now() + 600;

        // Broadcast complete paste content
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBufferRef.current,
        });

        // Swallow the very next Enter that terminals often emit after paste
        suppressReturnOnceRef.current = true;

        pasteBufferRef.current = '';
        return;
      }

      // During paste, accumulate content
      if (isPastingRef.current) {
        pasteBufferRef.current += str;
        // extend guard while data keeps flowing
        submitGuardUntilRef.current = Date.now() + 1500;
      }
    };

    /**
     * Handle readline parsed keypress events
     */
    let keypressCount = 0;
    let lastLogTime = Date.now();
    // Fallback paste detection variables
    let burstCount = 0;
    let lastKeyTs = 0;
    let pasteFallbackTimer: NodeJS.Timeout | null = null;
    let pasteWindowUntil = 0; // time until which we consider input as paste
    
    const handleKeypress = (str: string, key: any) => {
      keypressCount++;
      
      // Log every 100 keypresses or every second
      const now = Date.now();
      if (keypressCount % 100 === 0 || now - lastLogTime > 1000) {
        addLog(`[KeypressProvider] Received ${keypressCount} keypresses, latest: ${JSON.stringify(key.name || str)}, isPasting: ${isPastingRef.current}`);
        lastLogTime = now;
      }

      // Suppress one Enter immediately following a paste end
      if ((key?.name === 'return' || key?.name === 'enter') && suppressReturnOnceRef.current) {
        suppressReturnOnceRef.current = false;
        addLog('[KeypressProvider] Suppressed trailing Enter (post-paste)');
        return;
      }

      // Suppress Enter during global paste guard
      if (Date.now() < submitGuardUntilRef.current && (key?.name === 'return' || key?.name === 'enter')) {
        addLog('[KeypressProvider] Suppressed Enter by submit-guard');
        return;
      }

      // Always allow Ctrl+C to exit immediately
      if (key?.ctrl && (key.name === 'c' || key.sequence === '\u0003')) {
        addLog('[KeypressProvider] SIGINT (Ctrl+C)');
        try {
          process.kill(process.pid, 'SIGINT');
        } catch {}
        return;
      }

      // Ignore per-char keypress entirely during bracketed paste
      if (isBracketPasteRef.current) {
        return;
      }

      // Heuristic fallback: if a large burst of keys arrives quickly, treat as paste temporarily
      const gap = now - lastKeyTs;
      if (gap <= 40) {
        burstCount++;
      } else {
        burstCount = 1;
      }
      lastKeyTs = now;

      if (!isPastingRef.current && burstCount >= 32) {
        isPastingRef.current = true;
        pasteWindowUntil = now + 1000; // 1s window
        addLog('[KeypressProvider] Fallback paste start (burst)');
      }

      if (isPastingRef.current) {
        pasteWindowUntil = Math.max(pasteWindowUntil, now + 1200);
        if (pasteFallbackTimer) clearTimeout(pasteFallbackTimer);
        pasteFallbackTimer = setTimeout(() => {
          if (Date.now() >= pasteWindowUntil) {
            isPastingRef.current = false;
            burstCount = 0;
            // After heuristic paste ends, suppress a trailing Enter just in case
            suppressReturnOnceRef.current = true;
            addLog('[KeypressProvider] Fallback paste end (idle)');
          }
        }, 1200);
      }
      
      // Mark keys during paste as paste=true (prevents SUBMIT binding which requires paste=false)
      let isPasting = isPastingRef.current || (Date.now() < pasteWindowUntil);
      // Treat return within paste window as paste too (heuristic only)
      if (!isBracketPasteRef.current && (key?.name === 'return' || key?.name === 'enter') && Date.now() < pasteWindowUntil) {
        isPasting = true;
      }

      // Normalize key object
      const normalizedKey: Key = {
        name: key.name || '',
        ctrl: key.ctrl || false,
        meta: key.meta || false,
        shift: key.shift || false,
        paste: isPasting || Date.now() < submitGuardUntilRef.current,
        sequence: key.sequence || str || '',
      };

      broadcast(normalizedKey);
    };

    // Register event listeners (ensure paste detection runs BEFORE readline)
    stdin.prependListener('data', handleRawData);
    readline.emitKeypressEvents(stdin);
    stdin.on('keypress', handleKeypress);

    // Cleanup function
    return () => {
      stdin.off('data', handleRawData);
      stdin.off('keypress', handleKeypress);
      
      // reset paste state
      isPastingRef.current = false;
      isBracketPasteRef.current = false;
      pasteBufferRef.current = '';
      
      if (!wasRaw) {
        // Disable bracketed paste mode
        process.stdout.write('\x1B[?2004l');
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
