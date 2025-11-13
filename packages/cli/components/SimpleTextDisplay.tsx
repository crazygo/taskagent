import React, { useMemo } from 'react';
import { Text } from 'ink';

interface SimpleTextDisplayProps {
  value: string;
  placeholder?: string;
  isFocused?: boolean;
  caretIndex?: number; // visual caret position within value
}

export function SimpleTextDisplay({ value, placeholder, isFocused, caretIndex }: SimpleTextDisplayProps) {
  // Use inline styling for inverse caret to avoid nested <Text> ghost frames
  const parts = useMemo(() => {
    if (!value && placeholder && !isFocused) {
      return { text: placeholder, isPlaceholder: true };
    }
    const text = value ?? '';
    const ci = Math.max(0, Math.min(caretIndex ?? text.length, text.length));
    if (!isFocused) {
      return { text, isPlaceholder: false };
    }
    // Insert inverse caret at position
    const before = text.slice(0, ci);
    const caretChar = text[ci] ?? ' ';
    const after = text.slice(ci + 1);
    return { before, caretChar, after, isPlaceholder: false };
  }, [value, placeholder, isFocused, caretIndex]);

  if (parts.isPlaceholder) {
    return <Text color="gray" dimColor>{parts.text}</Text>;
  }
  
  if ('before' in parts) {
    // Focused with caret
    return (
      <Text>
        {parts.before}<Text inverse>{parts.caretChar}</Text>{parts.after}
      </Text>
    );
  }
  
  return <Text>{parts.text}</Text>;
}
