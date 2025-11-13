import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text } from 'ink';
import { CommandMenu } from './CommandMenu.js';
import { SimpleTextDisplay } from './SimpleTextDisplay.js';
import { addLog } from '@taskagent/shared/logger';
import { useCommand } from '../src/hooks/useCommand.js';
import { useKeypress, type Key } from '../src/hooks/useKeypress.js';
import { Command as KeyCommand } from '../src/config/keyBindings.js';
import { keyMatchers } from '../src/utils/keyMatchers.js';
import { SURFACE_BACKGROUND_COLOR } from './theme.js';

export interface Command {
  name: string;
  description: string;
}

interface InputBarProps {
  value: string;
  onChange: (value: string | ((prev: string) => string)) => void;
  onSubmit: (value: string) => void | Promise<unknown>;
  isFocused: boolean;
  onCommandMenuChange?: (isShown: boolean) => void;
  onEscStateChange?: (isEscActive: boolean) => void;
  commands: Command[];
}

const PASTE_THRESHOLD = 100;

export const InputBar: React.FC<InputBarProps> = ({
  value,
  onChange,
  onSubmit,
  isFocused,
  onCommandMenuChange,
  onEscStateChange,
  commands,
}) => {
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputVersion, setInputVersion] = useState(0);
  const [isEscActive, setIsEscActive] = useState(false);
  
  // Caret index for insert mode
  const [caretIndex, setCaretIndex] = useState<number>(value.length);
  const caretRef = useRef<number>(caretIndex);
  useEffect(() => { caretRef.current = caretIndex; }, [caretIndex]);
  // Keep caret within bounds on external value changes
  useEffect(() => { if (caretRef.current > value.length) setCaretIndex(value.length); }, [value]);

  const prevValueRef = useRef(value);
  const escTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (prevValueRef.current !== value) {
      setInputVersion(v => v + 1);
    }
    prevValueRef.current = value;
  }, [value]);

  // Handle first ESC press
  const handleFirstEsc = useCallback(() => {
    // Clear any existing timer
    if (escTimerRef.current) {
      clearTimeout(escTimerRef.current);
    }
    
    // Set ESC active state
    setIsEscActive(true);
    onEscStateChange?.(true);
    
    // Start 1-second timer
    escTimerRef.current = setTimeout(() => {
      setIsEscActive(false);
      onEscStateChange?.(false);
      escTimerRef.current = null;
    }, 1000);
  }, [onEscStateChange]);

  // Handle second ESC press
  const handleSecondEsc = useCallback(() => {
    // Clear input and reset state
    onChange('');
    setIsEscActive(false);
    onEscStateChange?.(false);
    
    // Clear timer
    if (escTimerRef.current) {
      clearTimeout(escTimerRef.current);
      escTimerRef.current = null;
    }
  }, [onChange, onEscStateChange]);

  // Handle all keypresses with batching for paste detection
  const pendingCharsRef = useRef('');
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingIsPasteRef = useRef(false);
  const recentPasteUntilRef = useRef<number>(0); // block submit within window
  // Store collapsed paste blocks for later expansion on submit
  const pasteStoreRef = useRef<{ placeholder: string; content: string }[]>([]);
  
  // Helper: flush pending characters immediately
  const flushPending = useCallback(() => {
    if (pendingCharsRef.current) {
      const chars = pendingCharsRef.current;
      onChange((prev: string) => {
        const ci = caretRef.current;
        const next = prev.slice(0, ci) + chars + prev.slice(ci);
        setCaretIndex(ci + chars.length);
        return next;
      });
      pendingCharsRef.current = '';
      pendingIsPasteRef.current = false;
    }
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, [onChange]);

  // Keep latest value in a ref to avoid stale closure on submit
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  // Handle submit command
  const handleSubmitCommand = useCallback(() => {
    // If paste window active, just flush and ignore submit to avoid accidental sends
    if (Date.now() < recentPasteUntilRef.current || pendingIsPasteRef.current) {
      flushPending();
      return;
    }

    // CRITICAL: Flush pending chars before submit
    flushPending();
    
    // Small delay to ensure state is updated
    setTimeout(() => {
      let current = valueRef.current;
      // Expand any paste placeholders back to original content
      if (pasteStoreRef.current.length) {
        for (const { placeholder, content } of pasteStoreRef.current) {
          // Replace all occurrences (user may paste same size twice)
          current = current.split(placeholder).join(content);
        }
        if (process.env.E2E_SENTINEL) {
          addLog(`[InputBar] Expanded ${pasteStoreRef.current.length} paste placeholder(s) before submit`);
        }
      }
      if (process.env.E2E_SENTINEL) {
        addLog(`[InputBar] SUBMIT command, value length=${current.length}`);
      }
      if (showCommandMenu) {
        return;
      }
      onSubmit(current);
      // Clear paste store after successful submit
      pasteStoreRef.current = [];
    }, 20);
  }, [showCommandMenu, onSubmit, flushPending]);

  // Subscribe to commands
  useCommand(KeyCommand.SUBMIT, handleSubmitCommand, { isActive: isFocused });
  
  // Reset caret to end after submit clears input
  useEffect(() => {
    if (value.length === 0 && caretRef.current !== 0) {
      setCaretIndex(0);
    }
  }, [value]);
  
  useKeypress(
    useCallback(
      (key: Key) => {
        if (!isFocused) return;
        
        if (key.name === 'escape') {
          flushPending();

          const menuWasOpen = showCommandMenu;
          if (menuWasOpen) {
            setShowCommandMenu(false);
            onCommandMenuChange?.(false);
          }

          if (isEscActive) {
            handleSecondEsc();
          } else {
            handleFirstEsc();
          }
          return;
        }
        
        // CRITICAL: Skip return/enter keys entirely - they should ONLY be handled as SUBMIT command
        // This prevents paste with newlines from triggering multiple submits
        if (key.name === 'return' || key.name === 'enter') {
          return;
        }
        
        // 1. Check if it's a command (handled by useCommand)
        const commandValues = Object.values(KeyCommand) as KeyCommand[];
        for (const cmd of commandValues) {
          if (keyMatchers[cmd](key)) {
            // Flush pending chars before command
            flushPending();
            return;
          }
        }

        // 2. Handle text editing
        // 2a. Arrow/home/end navigation
        if (key.name === 'left') {
          flushPending(); setCaretIndex(ci => Math.max(0, ci - 1)); return;
        }
        if (key.name === 'right') {
          flushPending(); setCaretIndex(ci => Math.min(valueRef.current.length, ci + 1)); return;
        }
        if (key.name === 'home') {
          flushPending(); setCaretIndex(0); return;
        }
        if (key.name === 'end') {
          flushPending(); setCaretIndex(valueRef.current.length); return;
        }

        if (key.name === 'backspace') {
          flushPending();
          onChange((prev: string) => {
            const ci = caretRef.current;
            if (ci > 0) {
              const next = prev.slice(0, ci - 1) + prev.slice(ci);
              setCaretIndex(ci - 1);
              return next;
            }
            return prev;
          });
          return;
        }
        if (key.name === 'delete') {
          flushPending();
          onChange((prev: string) => {
            const ci = caretRef.current;
            if (ci < prev.length) {
              const next = prev.slice(0, ci) + prev.slice(ci + 1);
              return next;
            }
            return prev;
          });
          return;
        }

        // 3. Normal printable characters - batch them
        if (key.sequence) {
          // Filter out any remaining newlines to prevent issues
          // Convert newlines to spaces
          const sanitized = key.sequence.replace(/[\r\n]/g, ' ');
          
          if (sanitized) {
            pendingCharsRef.current += sanitized;
            if (key.paste) pendingIsPasteRef.current = true;
            // Open a short paste window on any batched input to prevent accidental submit
            if (key.paste || sanitized.length > 1) {
              recentPasteUntilRef.current = Date.now() + 600;
            }
            
            // Clear existing timer
            if (batchTimerRef.current) {
              clearTimeout(batchTimerRef.current);
            }
            
            // Flush after 50ms of no new input (paste detection)
            batchTimerRef.current = setTimeout(() => {
              flushPending();
              batchTimerRef.current = null;
            }, 50);
          }
        }
      },
      [
        onChange,
        isFocused,
        flushPending,
        showCommandMenu,
        onCommandMenuChange,
        handleFirstEsc,
        handleSecondEsc,
        isEscActive,
      ],
    ),
    { isActive: true },
  );
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, []);

  // 检测是否应该显示命令菜单
  useEffect(() => {
    // 规则：
    // 1) 仅当以 '/' 开头时才考虑显示
    // 2) '/' 后面不能有空格（命令未完成）
    // 3) 必须有至少一个匹配项
    if (!value.startsWith('/')) {
      setShowCommandMenu(false);
      onCommandMenuChange?.(false);
      return;
    }

    const afterSlash = value.slice(1); // 不使用 trim，保留尾随空格
    if (afterSlash.includes(' ')) {
      // 命令后已有空格，认为命令已完成 -> 不展示
      setShowCommandMenu(false);
      onCommandMenuChange?.(false);
      return;
    }

    const query = afterSlash.toLowerCase();
    const filtered = query === ''
      ? commands
      : commands.filter(cmd => cmd.name.startsWith(query));

    setFilteredCommands(filtered);
    const isShown = filtered.length > 0;
    setShowCommandMenu(isShown);
    setSelectedIndex(0);
    onCommandMenuChange?.(isShown);
  }, [value, commands, onCommandMenuChange]);

  // Cleanup timer on component unmount
  useEffect(() => {
    return () => {
      if (escTimerRef.current) {
        clearTimeout(escTimerRef.current);
        escTimerRef.current = null;
      }
    };
  }, []);

  return (
    <Box flexDirection="column" backgroundColor={SURFACE_BACKGROUND_COLOR}>
      <Box paddingX={1} width="100%" flexDirection="row" backgroundColor={SURFACE_BACKGROUND_COLOR}>
        <Text color={isFocused ? 'blue' : 'white'}>&gt; </Text>
        <Box flexGrow={1} minWidth={0}>
          <SimpleTextDisplay
            key={`display-${inputVersion}`}
            value={value}
            placeholder="Type your message... or use /<command> <prompt>"
            isFocused={isFocused}
            caretIndex={caretIndex}
          />
        </Box>
      </Box>
      {showCommandMenu && (
        <CommandMenu commands={filteredCommands} selectedIndex={selectedIndex} />
      )}
    </Box>
  );
};
