import { Box, Text } from 'ink';
import React, { useCallback } from 'react';
import type { Task } from '@shared/task-manager';
import { addLog } from '@shared/logger';
import { useCommand } from '../src/hooks/useCommand.js';
import { Command } from '../src/config/keyBindings.js';
import { ACTIVE_TAB_BACKGROUND_COLOR } from './theme.js';



// A new, more generic TabView component
interface TabViewProps {
  staticOptions: readonly string[];
  tasks: Task[];
  selectedTab: string;
  onTabChange: (tab: string) => void;
  isFocused: boolean;
}

export const TabView: React.FC<TabViewProps> = ({ staticOptions, tasks, selectedTab, onTabChange }) => {
  const taskTabs = tasks.map((_, index) => `Task ${index + 1}`);
  const allTabs = [...staticOptions, ...taskTabs];

  // Handle tab navigation with useCommand
  const handleNextTab = useCallback(() => {
    if (allTabs.length === 0) return;
    const currentIndex = allTabs.indexOf(selectedTab);
    if (process.env.E2E_SENTINEL) {
      addLog(`[TabView] SWITCH_TAB_NEXT, switching from ${selectedTab} (index ${currentIndex}) to next tab`);
    }
    const newIndex = (currentIndex + 1) % allTabs.length;
    onTabChange(allTabs[newIndex]!);
  }, [allTabs, selectedTab, onTabChange]);

  const handlePrevTab = useCallback(() => {
    if (allTabs.length === 0) return;
    const currentIndex = allTabs.indexOf(selectedTab);
    if (process.env.E2E_SENTINEL) {
      addLog(`[TabView] SWITCH_TAB_PREV, switching from ${selectedTab} (index ${currentIndex}) to prev tab`);
    }
    const newIndex = (currentIndex - 1 + allTabs.length) % allTabs.length;
    onTabChange(allTabs[newIndex]!);
  }, [allTabs, selectedTab, onTabChange]);

  // Subscribe to commands (always active for global shortcuts)
  useCommand(Command.SWITCH_TAB_NEXT, handleNextTab, { isActive: true });
  useCommand(Command.SWITCH_TAB_PREV, handlePrevTab, { isActive: true });

  return (
    <Box flexDirection="row" width="100%">
      {allTabs.map((tab, idx) => {
        const selected = selectedTab === tab;
        const backgroundColor = selected ? ACTIVE_TAB_BACKGROUND_COLOR : 'gray';
        const color = selected ? 'black' : 'white';
        const indicator = selected ? '› ' : '  ';
        return (
          <Box key={`${tab}-${idx}`} backgroundColor={backgroundColor as any} paddingX={1}>
            <Text color={color as any}>{`${indicator}${tab} `}</Text>
          </Box>
        );
      })}
      <Box flexGrow={1} backgroundColor="gray"></Box>
    </Box>
  );
};
