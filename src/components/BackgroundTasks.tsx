import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Task } from '../../task-manager.ts';

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

interface BackgroundTasksProps {
  tasks: Task[];
  isFocused: boolean;
}

export const BackgroundTasks: React.FC<BackgroundTasksProps> = ({ tasks, isFocused }) => {
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const userSelectedRef = useRef(false);
  const [taskScrollOffsets, setTaskScrollOffsets] = useState<Record<string, number>>({});

  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskIndex(0);
      userSelectedRef.current = false;
      setTaskScrollOffsets({});
    } else {
      if (selectedTaskIndex >= tasks.length) {
        setSelectedTaskIndex(tasks.length - 1);
        userSelectedRef.current = false;
      } else if (!userSelectedRef.current && tasks.length > 0) {
        setSelectedTaskIndex(tasks.length - 1);
      }
    }
  }, [tasks, selectedTaskIndex]);

  useEffect(() => {
    setTaskScrollOffsets(prev => {
      const next: Record<string, number> = {};
      tasks.forEach(task => {
        const lines = splitOutputIntoLines(task.output || '');
        const previous = prev[task.id] ?? 0;
        const maxOffset = Math.max(0, lines.length - Math.min(lines.length, TASK_PAGE_SIZE));
        next[task.id] = Math.min(previous, maxOffset);
      });
      return next;
    });
  }, [tasks]);

  useInput((input, key) => {
    if (!isFocused || tasks.length === 0) {
      return;
    }

    const selectedTask = tasks[selectedTaskIndex];
    const selectedOffset = selectedTask ? taskScrollOffsets[selectedTask.id] ?? 0 : 0;

    if (key.leftArrow && tasks.length > 0) {
      setSelectedTaskIndex(prev => {
        const next = prev > 0 ? prev - 1 : tasks.length - 1;
        userSelectedRef.current = true;
        return next;
      });
    } else if (key.rightArrow && tasks.length > 0) {
      setSelectedTaskIndex(prev => {
        const next = prev < tasks.length - 1 ? prev + 1 : 0;
        userSelectedRef.current = true;
        return next;
      });
    } else if (input === 'f') {
      setTaskScrollOffsets(prev => {
        const nextOffset = Math.max(0, selectedOffset - TASK_PAGE_SIZE);
        return selectedTask ? { ...prev, [selectedTask.id]: nextOffset } : prev;
      });
    } else if (input === 'b') {
      setTaskScrollOffsets(prev => {
        const lines = splitOutputIntoLines(selectedTask?.output || '');
        const maxOffset = Math.max(0, lines.length - TASK_PAGE_SIZE);
        const nextOffset = Math.min(maxOffset, selectedOffset + TASK_PAGE_SIZE);
        return selectedTask ? { ...prev, [selectedTask.id]: nextOffset } : prev;
      });
    } else if (key.upArrow) {
      setTaskScrollOffsets(prev => {
        const nextOffset = Math.max(0, selectedOffset - 1);
        return selectedTask ? { ...prev, [selectedTask.id]: nextOffset } : prev;
      });
    } else if (key.downArrow) {
      setTaskScrollOffsets(prev => {
        const lines = splitOutputIntoLines(selectedTask?.output || '');
        const maxOffset = Math.max(0, lines.length - TASK_PAGE_SIZE);
        const nextOffset = Math.min(maxOffset, selectedOffset + 1);
        return selectedTask ? { ...prev, [selectedTask.id]: nextOffset } : prev;
      });
    }
  }, { isActive: isFocused });

  const selectedTask = tasks[selectedTaskIndex];
  const selectedOffset = selectedTask ? taskScrollOffsets[selectedTask.id] ?? 0 : 0;
  const lines = selectedTask ? splitOutputIntoLines(selectedTask.output || '') : [];
  const totalLines = lines.length;
  const visibleCount = Math.min(lines.length, TASK_PAGE_SIZE);
  const sliceEnd = Math.max(0, totalLines - selectedOffset);
  const sliceStart = Math.max(0, sliceEnd - TASK_PAGE_SIZE);
  const visibleLines = lines.slice(sliceStart, sliceEnd);

  return (
    <Box
      borderStyle="round"
      borderColor={isFocused ? 'blue' : 'gray'}
      paddingX={1}
      flexDirection="column"
    >
      <Box flexDirection="row">
        <Text color="white">Background Tasks </Text>
        {tasks.map((task, index) => {
          const isSelected = index === selectedTaskIndex;
          return (
            <Text key={task.id} color={isSelected ? 'green' : 'white'}>
              {isSelected ? `[${index}]` : ` ${index} `}
            </Text>
          );
        })}
      </Box>
      <Text color="gray">───────────────────────────────────────────────────────────</Text>

      {tasks.length > 0 ? (
        <Box flexDirection="column">
          {selectedTask ? (
            <Box flexDirection="column">
              <Text>
                Task {selectedTaskIndex}: {selectedTask.id} | Status: {selectedTask.status} | Prompt: {formatPrompt(selectedTask.prompt)}
              </Text>
              {visibleLines.length > 0 ? (
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Text>Output: </Text>
                    <Text>{visibleLines[0] || ' '}</Text>
                  </Box>
                  {visibleLines.slice(1).map((line, index) => (
                    <Text key={`${selectedTask.id}-${sliceStart + index + 1}`}>
                      {line || ' '}
                    </Text>
                  ))}
                </Box>
              ) : (
                <Text color="gray">Output: No output yet</Text>
              )}
              {(totalLines > visibleCount || isFocused) && (
                <Text color="gray">
                  Showing lines {sliceStart + 1}-{sliceEnd} of {totalLines}
                  {isFocused ? ' (Use ← → to switch tasks, b/f to page, ↑/↓ to scroll)' : ''}
                </Text>
              )}
            </Box>
          ) : (
            <Text color="gray">No task selected.</Text>
          )}
        </Box>
      ) : (
        <Text color="gray">
          No background tasks running.
        </Text>
      )}
    </Box>
  );
};
