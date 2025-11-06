import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Task } from '@taskagent/shared/task-manager';

const TASK_PAGE_SIZE = 5;

const splitOutputIntoLines = (output: string) => {
  if (!output) {
    return [];
  }
  return output.split(/\r?\n/);
};

const formatPrompt = (prompt: string | undefined, wordLimit = 20) => {
  if (!prompt) {
    return '';
  }
  const words = prompt.trim().split(/\s+/);
  if (words.length <= wordLimit) {
    return words.join(' ');
  }
  return `${words.slice(0, wordLimit).join(' ')} …`;
};

interface TaskSpecificViewProps {
  task: Task;
  taskNumber: number;
  isFocused: boolean;
}

export const TaskSpecificView: React.FC<TaskSpecificViewProps> = ({ task, taskNumber, isFocused }) => {
  const [scrollOffset, setScrollOffset] = useState(0);

  // Reset scroll offset if task changes
  useEffect(() => {
    setScrollOffset(0);
  }, [task.id]);

  // Adjust scroll offset if output becomes shorter
  useEffect(() => {
    const lines = splitOutputIntoLines(task.output || '');
    const maxOffset = Math.max(0, lines.length - TASK_PAGE_SIZE);
    if (scrollOffset > maxOffset) {
      setScrollOffset(maxOffset);
    }
  }, [task.output, scrollOffset]);

  useInput((input, key) => {
    if (!isFocused) {
      return;
    }

    const lines = splitOutputIntoLines(task.output || '');
    const maxOffset = Math.max(0, lines.length - TASK_PAGE_SIZE);

    if (input === 'f') {
      setScrollOffset(prev => Math.max(0, prev - TASK_PAGE_SIZE));
    } else if (input === 'b') {
      setScrollOffset(prev => Math.min(maxOffset, prev + TASK_PAGE_SIZE));
    } else if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setScrollOffset(prev => Math.min(maxOffset, prev + 1));
    }
  }, { isActive: isFocused });

  const lines = splitOutputIntoLines(task.output || '');
  const totalLines = lines.length;
  const visibleCount = Math.min(lines.length, TASK_PAGE_SIZE);

  // Corrected slicing logic for scrolling from the bottom
  const sliceEnd = Math.max(0, totalLines - scrollOffset);
  const sliceStart = Math.max(0, sliceEnd - TASK_PAGE_SIZE);
  const visibleLines = lines.slice(sliceStart, sliceEnd);

  return (
    <Box
      borderStyle="round"
      borderColor={isFocused ? 'blue' : 'gray'}
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        Task {taskNumber}: {task.id}
        {task.sdkSessionId ? ` | SDK Session: ${task.sdkSessionId}` : ''}
        {` | Status: ${task.status} | Prompt: ${formatPrompt(task.prompt)}`}
      </Text>
      <Text color="gray">{`─`.repeat(80)}</Text>
      {visibleLines.length > 0 ? (
        <Box flexDirection="column">
          {visibleLines.map((line, index) => (
            <Text key={`${task.id}-${sliceStart + index}`}>
              {line || ' '}
            </Text>
          ))}
        </Box>
      ) : (
        <Text color="gray">No output yet</Text>
      )}
      {(totalLines > visibleCount || isFocused) && (
        <Text color="gray">
          Showing lines {sliceStart + 1}-{sliceEnd} of {totalLines}
          {isFocused ? ' (Use b/f to page, ↑/↓ to scroll)' : ''}
        </Text>
      )}
    </Box>
  );
};
