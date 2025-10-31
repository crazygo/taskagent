import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { CommandMenu } from './CommandMenu.js';
import { addLog } from '../logger.js';

export interface Command {
  name: string;
  description: string;
}

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<unknown>;
  isFocused: boolean;
  onCommandMenuChange?: (isShown: boolean) => void;
  onEscStateChange?: (isEscActive: boolean) => void;
  commands: Command[];
}

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
  const [inputVersion, setInputVersion] = useState(0); // bump to remount input and move cursor to end
  const [isEscActive, setIsEscActive] = useState(false);
  // 撤回 Ctrl+N 对输入框的干预，仅做日志观测
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

  // 当下拉命令菜单显示时，阻止 TextInput 的回车提交
  const handleTextInputSubmit = (text: string) => {
    if (process.env.E2E_SENTINEL) {
      addLog(`[InputBar] TextInput onSubmit triggered with text="${text}" (showCommandMenu=${showCommandMenu})`);
    }
    if (showCommandMenu) {
      // 命令菜单场景下，Enter 只用于上屏（在 useInput 中处理），此处不提交
      return;
    }
    onSubmit(text);
  };

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

  // 仅记录：输入框层面捕获到 Ctrl+N，不做任何拦截
  useInput((input, key) => {
    if (key.ctrl && (input === 'n' || input === 'N')) {
      addLog(`[InputBar] Ctrl+N detected (isFocused=${isFocused})`);
    }
  }, { isActive: isFocused });

  // 处理下拉菜单中的按键事件
  useInput((input, key) => {
    if (!isFocused || !showCommandMenu) return;

    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
    } else if (key.tab) {
      // Tab 键：自动补全并添加空格，不提交
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        onChange(`/${selected.name} `);
        setShowCommandMenu(false);
        setInputVersion(v => v + 1); // 重新挂载以将光标放到末尾
      }
    } else if (key.return && filteredCommands.length > 0) {
      // Enter 键：自动补全并添加空格，不提交
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        onChange(`/${selected.name} `);
        setShowCommandMenu(false);
        setInputVersion(v => v + 1); // 重新挂载以将光标放到末尾
      }
    } else if (key.escape) {
      setShowCommandMenu(false);
    }
  }, { isActive: isFocused && showCommandMenu });

  // Handle double-ESC clearing mechanism
  useInput((input, key) => {
    if (!key.escape) return;
    
    if (isEscActive) {
      handleSecondEsc();
    } else {
      handleFirstEsc();
    }
  }, { isActive: isFocused && !showCommandMenu });

  // 仅记录变化轨迹，不做抑制
  const handleChange = (next: string) => {
    onChange(next);
  };

  return (
    <Box flexDirection="column">
      <Box paddingX={1} width="100%">
        <Text color={isFocused ? 'blue' : 'white'}>&gt; </Text>
        <TextInput
          key={inputVersion}
          value={value}
          onChange={handleChange}
          onSubmit={handleTextInputSubmit}
          placeholder="Type your message... or use /task <prompt>"
          focus={isFocused}
        />
      </Box>
      {showCommandMenu && (
        <CommandMenu commands={filteredCommands} selectedIndex={selectedIndex} />
      )}
    </Box>
  );
};
