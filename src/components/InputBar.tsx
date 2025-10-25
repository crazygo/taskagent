import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { CommandMenu } from './CommandMenu.tsx';

interface Command {
  name: string;
  description: string;
}

const COMMANDS: Command[] = [
  { name: 'plan-review-do', description: 'Execute task with plan-review-do workflow' },
  { name: 'task', description: 'Create a background task' },
];

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<unknown>;
  isFocused: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({ value, onChange, onSubmit, isFocused }) => {
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 检测是否应该显示命令菜单
  useEffect(() => {
    const trimmed = value.trim();
    
    // 检查是否以 / 开头或在空白后有 /
    const shouldShow = trimmed.startsWith('/');
    
    if (shouldShow) {
      const query = trimmed.slice(1).toLowerCase();
      const filtered = query === '' 
        ? COMMANDS 
        : COMMANDS.filter(cmd => cmd.name.startsWith(query));
      
      setFilteredCommands(filtered);
      setShowCommandMenu(filtered.length > 0);
      setSelectedIndex(0); // 重置选中项
    } else {
      setShowCommandMenu(false);
    }
  }, [value]);

  // 处理键盘事件
  useInput((input, key) => {
    if (!isFocused || !showCommandMenu) return;

    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
    } else if (key.tab || (key.return && filteredCommands.length > 0)) {
      // Tab 或 Enter 自动补全
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        onChange(`/${selected.name} `);
        setShowCommandMenu(false);
      }
    } else if (key.escape) {
      setShowCommandMenu(false);
    }
  }, { isActive: isFocused && showCommandMenu });

  return (
    <Box flexDirection="column">
      <Box paddingX={1} backgroundColor="gray" width="100%">
        <Text color={isFocused ? 'blue' : 'white'}>&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
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
