import { Box, Text, useInput } from 'ink';
import React from 'react';
import type { Task } from '../../task-manager.js';
import { Driver } from '../drivers/types.js';



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
    if (allTabs.length === 0) return;

    const currentIndex = allTabs.indexOf(selectedTab);

    const handleSelect = (newIndex: number) => {
      onTabChange(allTabs[newIndex]!);
    };

    if (key.ctrl && input === 'n') {
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
        const color = selected ? 'white' : (isFocused ? 'white' : 'gray');
        const backgroundColor = selected ? undefined : 'gray';
                        return (
                          <Box key={tab} backgroundColor={backgroundColor as any}>
                            <Text color={color as any} paddingRight={1}>{` ${tab} `}</Text>
                          </Box>
                        );
        
      })}
      <Box flexGrow={1} backgroundColor="gray"></Box>
    </Box>
  );
};


