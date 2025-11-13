import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text } from 'ink';
import { CommandMenu } from './CommandMenu.js';
import { SimpleTextDisplay } from './SimpleTextDisplay.js';
import { addLog } from '@taskagent/shared/logger';
import { useCommand } from '../src/hooks/useCommand.js';
import { useKeypress, type Key } from '../src/hooks/useKeypress.js';
import { Command as KeyCommand } from '../src/config/keyBindings.js';
import { keyMatchers } from '../src/utils/keyMatchers.js';

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
  
  const prevValueRef = useRef(value);
  const escTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
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

  // Handle submit command
  const handleSubmitCommand = useCallback(() => {
    if (process.env.E2E_SENTINEL) {
      addLog(`[InputBar] SUBMIT command, value="${value}"`);
    }
    if (showCommandMenu) {
      return;
    }
    onSubmit(value);
  }, [value, showCommandMenu, onSubmit]);

  // Subscribe to commands
  useCommand(KeyCommand.SUBMIT, handleSubmitCommand, { isActive: isFocused });

  // Handle all keypresses including paste
  useKeypress(
    useCallback(
      (key: Key) => {
        if (!isFocused) return;
        
        // 1. Handle paste events
        if (key.paste) {
          const length = key.sequence.length;
          if (process.env.E2E_SENTINEL) {
            addLog(`[InputBar] Paste detected: ${length} chars`);
          }

          if (length >= PASTE_THRESHOLD) {
            onChange(() => `[Pasted ${length} chars]`);
          } else {
            onChange((prev: string) => prev + key.sequence);
          }
          return;
        }

        // 2. Check if it's a command (handled by useCommand)
        const commandValues = Object.values(KeyCommand) as KeyCommand[];
        for (const cmd of commandValues) {
          if (keyMatchers[cmd](key)) {
            return;
          }
        }

        // 3. Handle text editing
        if (key.name === 'backspace' || key.name === 'delete') {
          onChange((prev: string) => {
            if (prev.length > 0) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          return;
        }

        // 4. Normal printable characters (space, Chinese, etc.)
        if (key.sequence) {
          onChange((prev: string) => prev + key.sequence);
        }
      },
      [onChange, isFocused],
    ),
    { isActive: true },
  );

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
    <Box flexDirection="column">
      <Box paddingX={1} width="100%">
        <Text color={isFocused ? 'blue' : 'white'}>&gt; </Text>
        <SimpleTextDisplay
          value={value}
          placeholder="Type your message... or use /<command> <prompt>"
          isFocused={isFocused}
        />
      </Box>
      {showCommandMenu && (
        <CommandMenu commands={filteredCommands} selectedIndex={selectedIndex} />
      )}
    </Box>
  );
};
