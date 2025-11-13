import React, { useMemo } from 'react';
import { Text } from 'ink';

interface SimpleTextDisplayProps {
  value: string;
  placeholder?: string;
  isFocused?: boolean;
}

export function SimpleTextDisplay({ value, placeholder, isFocused }: SimpleTextDisplayProps) {
  // Use useMemo to stabilize content and prevent render flickering
  const displayContent = useMemo(() => {
    const text = value || (placeholder && !isFocused ? placeholder : '');
    const cursor = isFocused ? '|' : ''; // Use simple pipe character
    return text + cursor;
  }, [value, placeholder, isFocused]);
  
  const textColor = value ? 'white' : 'gray';
  
  return <Text color={textColor as any}>{displayContent}</Text>;
}
