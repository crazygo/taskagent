import { Box, Text, useInput } from 'ink';
import React from 'react';
import type { Task } from '../../task-manager.js';
import { Driver } from '../drivers/types.js';
import { addLog } from '../logger.js';



// A new, more generic TabView component
interface TabViewProps {
  staticOptions: readonly string[];
  tasks: Task[];
  selectedTab: string;
  onTabChange: (tab: string) => void;
  isFocused: boolean;
}

export const TabView: React.FC<TabViewProps> = ({ staticOptions, tasks, selectedTab, onTabChange, isFocused }) => {
  const taskTabs = tasks.map((task, index) => `Task ${index + 1}`);
  const allTabs = [...staticOptions, ...taskTabs];

  useInput((input, key) => {
    // Debug logging (only when E2E sentinel is active)
    if (process.env.E2E_SENTINEL && (input || key.ctrl || key.shift || key.meta)) {
      const inputCode = input ? input.charCodeAt(0) : null;
      addLog(`[TabView] input="${input}" charCode=${inputCode} ctrl=${key.ctrl} shift=${key.shift} meta=${key.meta}`);
    }

    if (allTabs.length === 0) return;

    const currentIndex = allTabs.indexOf(selectedTab);

    const handleSelect = (newIndex: number) => {
      onTabChange(allTabs[newIndex]!);
    };

    // Handle both user Ctrl+N and programmatic \x0e (for E2E testing)
    if ((key.ctrl && input === 'n') || input === '\x0e') {
      if (process.env.E2E_SENTINEL) {
        addLog(`[TabView] Ctrl+N detected, switching from ${selectedTab} (index ${currentIndex}) to next tab`);
      }
      const newIndex = (currentIndex + 1) % allTabs.length;
      handleSelect(newIndex);
      return;
    }

    if (!isFocused) return;

    if (key.leftArrow) {
      const newIndex = currentIndex > 0 ? currentIndex - 1 : allTabs.length - 1;
      handleSelect(newIndex);
    } else if (key.rightArrow) {
      const newIndex = currentIndex < allTabs.length - 1 ? currentIndex + 1 : 0;
      handleSelect(newIndex);
    }
  }, { isActive: true });

  return (
    <Box flexDirection="row" width="100%">
      {allTabs.map(tab => {
        const selected = selectedTab === tab;
        const backgroundColor = selected ? 'white' : 'gray';
        const color = selected ? 'black' : 'white';
                        return (
                          <Box key={tab} backgroundColor={backgroundColor as any} paddingX={1}>
                            <Text color={color as any}>{` ${tab} `}</Text>
                          </Box>
                        );
        
      })}
      <Box flexGrow={1} backgroundColor="gray"></Box>
    </Box>
  );
};

