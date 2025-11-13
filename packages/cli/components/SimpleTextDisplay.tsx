import React, { useMemo } from 'react';
import { Text } from 'ink';

interface SimpleTextDisplayProps {
  value: string;
  placeholder?: string;
  isFocused?: boolean;
  caretIndex?: number; // visual caret position within value
}

export function SimpleTextDisplay({ value, placeholder, isFocused, caretIndex }: SimpleTextDisplayProps) {
  const { before, caretChar, after, showPlaceholder } = useMemo(() => {
    if (!value && placeholder && !isFocused) {
      return { before: '', caretChar: '', after: placeholder, showPlaceholder: true };
    }
    const text = value ?? '';
    const ciRaw = typeof caretIndex === 'number' ? caretIndex : text.length;
    const ci = Math.max(0, Math.min(ciRaw, text.length));
    const before = text.slice(0, ci);
    const caretChar = text[ci] ?? ' ';
    const after = ci < text.length ? text.slice(ci + 1) : '';
    return { before, caretChar, after, showPlaceholder: false };
  }, [value, placeholder, isFocused, caretIndex]);
  
  if (!isFocused && !value && placeholder) {
    return <Text color="gray" dimColor>{after}</Text>;
  }

  return (
    <Text>
      <Text>{before}</Text>
      {isFocused ? (
        <Text inverse>{caretChar}</Text>
      ) : (
        <Text>{caretChar}</Text>
      )}
      <Text>{after}</Text>
    </Text>
  );
}
