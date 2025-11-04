import React from 'react';
import { Box, Text } from 'ink';

interface Command {
  name: string;
  description: string;
}

interface CommandMenuProps {
  commands: Command[];
  selectedIndex: number;
}

export const CommandMenu: React.FC<CommandMenuProps> = ({ commands, selectedIndex }) => {
  if (commands.length === 0) return null;

  return (
    <Box
      paddingX={1}
      flexDirection="column"
      backgroundColor="gray"
      width="100%"
    >
      {commands.map((cmd, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={cmd.name} flexDirection="row" backgroundColor="gray">
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {isSelected ? '▶ ' : '  '}
            </Text>
            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
              {cmd.name}
            </Text>
            <Text color="gray">  {cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
