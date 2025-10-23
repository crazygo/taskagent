import React from 'react';
import { Box } from 'ink';
import TextInput from 'ink-text-input';

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<unknown>;
  isFocused: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({ value, onChange, onSubmit, isFocused }) => (
  <Box borderStyle="single" borderColor={isFocused ? 'blue' : 'gray'} paddingX={1}>
    <TextInput
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder="Type your message... or use /task <prompt>"
      focus={isFocused}
    />
  </Box>
);
