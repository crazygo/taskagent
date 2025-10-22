
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import React, {useState, useEffect, useRef} from 'react';
import {render, Text, Box, Newline, Static, useInput} from 'ink';
import TextInput from 'ink-text-input';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { TaskManager, type Task } from './task-manager.ts';

// --- Logging Setup ---
const LOG_FILE = 'debug.log';
const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
};

// --- Environment Variable Workaround ---
if (process.env.OPENROUTER_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENROUTER_API_KEY;
}

// --- AI Configuration ---
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const openrouter = createOpenAI({
    baseURL: OPENROUTER_BASE_URL,
});

// --- Model Configuration ---
const modelName = process.env.OPENROUTER_MODEL_NAME || 'google/gemini-flash';

// --- Task Manager ---
const taskManager = new TaskManager();

// --- Types ---
type MessageType = 'user' | 'assistant' | 'system';

interface Message {
    id: number;
    role: MessageType;
    content: string;
    isBoxed?: boolean;
    isPending?: boolean;
}

type LogMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

enum Kernel {
  CLAUDE_CODE = 'Claude Code',
  GEMINI = 'Gemini',
  CODEX = 'Codex',
}

enum Driver {
  MANUAL = 'Manual',
  PLAN_REVIEW_DO = 'Plan-Review-DO',
  AUTO_COMMIT = 'L2+',
  CUSTOM = 'Custom',
}


// --- Components ---

interface OptionGroupProps<T extends string> {
  title: string;
  options: T[];
  selectedValue: T;
  onSelect: (value: T) => void;
  isFocused: boolean;
}

const OptionGroup = <T extends string>({ title, options, selectedValue, onSelect, isFocused }: OptionGroupProps<T>) => {
  useInput(
    (input, key) => {
      if (key.leftArrow) {
        const currentIndex = options.indexOf(selectedValue);
        const newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
        onSelect(options[newIndex]);
      } else if (key.rightArrow) {
        const currentIndex = options.indexOf(selectedValue);
        const newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
        onSelect(options[newIndex]);
      }
    },
    { isActive: isFocused }
  );

  return (
    <Box>
      <Box><Text color={isFocused ? 'blue' : 'white'}>{title}:</Text></Box>
      {options.map(option => (
        <Box key={option} marginRight={2}>
          <Text color={isFocused ? 'blue' : 'white'}>
            {selectedValue === option ? '(◉)' : '(○)'} {option}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

const WelcomeScreen = React.memo(() => (
    <Box borderStyle="round" paddingX={2} flexDirection="column">
        <Box>
            <Box flexGrow={1} flexDirection="column">
                <Text>TaskAgent v0.0.1</Text>

                <Text>Agent Model: {process.env.OPENROUTER_MODEL_NAME || 'Not Set'}</Text>
                <Text>Coder Model: {process.env.ANTHROPIC_MODEL || 'Not Set'}</Text>
                <Text>Working Directory: {process.cwd()}</Text>
            </Box>

        </Box>
    </Box>
));

interface MessageProps {
    message: Message;
}

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
    let prefix = '';
    let textColor: "white" | "gray" | "yellow" = 'white';
    let boxProps = {};

    if (message.role === 'user') {
        prefix = '> ';
        textColor = 'white';
    } else if (message.role === 'assistant') {
        prefix = '✦ ';
        textColor = 'gray';
    } else if (message.role === 'system') {
        prefix = 'ℹ️ ';
        textColor = 'yellow';
        if (message.isBoxed) {
            boxProps = {
                borderStyle: 'round',
                borderColor: 'red',
                paddingX: 1,
            };
        }
    }

    const pendingSuffix = message.isPending ? ' (queued)' : '';
    const content = (
        <Text color={textColor}>
            {prefix}{message.content}{pendingSuffix}
        </Text>
    );

    return (
        <Box {...boxProps}>
            {content}
        </Box>
    );
};

interface HistoryProps {
    messages: Message[];
}

const ActiveHistory: React.FC<HistoryProps> = React.memo(({ messages }) => (
	<Box flexDirection="column">
		{messages.map((msg) => (
			<MessageComponent key={msg.id} message={msg} />
		))}
	</Box>
));

interface TaskListProps {
  tasks: Task[];
  isFocused: boolean; // New prop for active state
}

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

const STREAM_TOKEN_TIMEOUT_MS = 10_000;

const TaskList: React.FC<TaskListProps> = ({ tasks, isFocused }) => {
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const userSelectedRef = useRef(false); // Track if user has manually selected
  const [taskScrollOffsets, setTaskScrollOffsets] = useState<Record<string, number>>({});

  // Update selectedTaskIndex when tasks change
  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskIndex(0);
      userSelectedRef.current = false; // Reset user selection flag
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

  // Clamp scroll offsets when outputs change
  useEffect(() => {
    setTaskScrollOffsets(prev => {
      const next: Record<string, number> = {};
      tasks.forEach(task => {
        const lines = splitOutputIntoLines(task.output);
        const maxOffset = Math.max(0, lines.length - Math.min(lines.length, TASK_PAGE_SIZE));
        const previous = prev[task.id] ?? 0;
        next[task.id] = Math.min(previous, maxOffset);
      });
      return next;
    });
  }, [tasks]);

  // Input handling for left/right arrows to switch tabs
  useInput(
    (input, key) => {
      if (!isFocused || tasks.length === 0) {
        return;
      }

      if (key.leftArrow) {
        userSelectedRef.current = true;
        const nextIndex = selectedTaskIndex > 0 ? selectedTaskIndex - 1 : tasks.length - 1;
        setSelectedTaskIndex(nextIndex);
        const nextTask = tasks[nextIndex];
        if (nextTask) {
          setTaskScrollOffsets(prev => {
            if ((prev[nextTask.id] ?? 0) === 0) {
              return prev;
            }
            return { ...prev, [nextTask.id]: 0 };
          });
        }
      } else if (key.rightArrow) {
        userSelectedRef.current = true;
        const nextIndex = selectedTaskIndex < tasks.length - 1 ? selectedTaskIndex + 1 : 0;
        setSelectedTaskIndex(nextIndex);
        const nextTask = tasks[nextIndex];
        if (nextTask) {
          setTaskScrollOffsets(prev => {
            if ((prev[nextTask.id] ?? 0) === 0) {
              return prev;
            }
            return { ...prev, [nextTask.id]: 0 };
          });
        }
      } else if (input.toLowerCase() === 'b') {
        const task = tasks[selectedTaskIndex];
        if (!task) return;
        setTaskScrollOffsets(prev => {
          const lines = splitOutputIntoLines(task.output);
          const maxOffset = Math.max(0, lines.length - Math.min(lines.length, TASK_PAGE_SIZE));
          const current = prev[task.id] ?? 0;
          const next = Math.min(maxOffset, current + TASK_PAGE_SIZE);
          if (next === current) return prev;
          return { ...prev, [task.id]: next };
        });
      } else if (input.toLowerCase() === 'f') {
        const task = tasks[selectedTaskIndex];
        if (!task) return;
        setTaskScrollOffsets(prev => {
          const current = prev[task.id] ?? 0;
          if (current === 0) {
            return prev;
          }
          return { ...prev, [task.id]: Math.max(0, current - TASK_PAGE_SIZE) };
        });
      } else if (key.upArrow) {
        const task = tasks[selectedTaskIndex];
        if (!task) return;
        setTaskScrollOffsets(prev => {
          const lines = splitOutputIntoLines(task.output);
          const maxOffset = Math.max(0, lines.length - Math.min(lines.length, TASK_PAGE_SIZE));
          const current = prev[task.id] ?? 0;
          const next = Math.min(maxOffset, current + 1);
          if (next === current) return prev;
          return { ...prev, [task.id]: next };
        });
      } else if (key.downArrow) {
        const task = tasks[selectedTaskIndex];
        if (!task) return;
        setTaskScrollOffsets(prev => {
          const current = prev[task.id] ?? 0;
          if (current === 0) {
            return prev;
          }
          return { ...prev, [task.id]: current - 1 };
        });
      }
    },
    { isActive: isFocused } // Only active when TaskList is focused
  );

  const selectedTask = tasks[selectedTaskIndex];
  const selectedOffset = selectedTask ? taskScrollOffsets[selectedTask.id] ?? 0 : 0;
  const selectedLines = selectedTask ? splitOutputIntoLines(selectedTask.output) : [];
  const totalLines = selectedLines.length;
  const sliceEnd = Math.max(0, totalLines - selectedOffset);
  const sliceStart = Math.max(0, sliceEnd - TASK_PAGE_SIZE);
  const visibleLines =
    totalLines === 0 ? [] : selectedLines.slice(sliceStart, sliceEnd);
  const visibleCount = visibleLines.length;

  // Determine border style based on focus
  const borderStyle = isFocused ? 'double' : 'round'; // Use 'double' for active, 'round' for inactive
  const borderColor = isFocused ? 'blue' : 'gray';

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={borderColor}
      paddingX={1}
      paddingY={0}
    >
      <Box flexDirection="row" alignItems="center">
        <Text bold>Background Tasks</Text>
        <Box flexGrow={1} />
        <Box
          flexDirection="row"
          alignItems="center"
          flexWrap="nowrap"
        >
          {tasks.slice(0, 4).map((task, index) => {
            const isSelected = index === selectedTaskIndex;
            return (
              <Box key={task.id} flexDirection="row" marginLeft={index === 0 ? 0 : 1}>
                {isSelected && (
                  <Text color="cyan" bold>
                    {'> '}
                  </Text>
                )}
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                  [T{index + 1}]
                </Text>
              </Box>
            );
          })}
          {tasks.length > 4 && (
            <Box marginLeft={1}>
              <Text color="gray">...</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text>
          ───────────────────────────────────────────────────────────────────────────
        </Text>
      </Box>

      {selectedTask ? (
        <Box flexDirection="column">
          <Text>
            Task ID: {selectedTask.id} | Status: {selectedTask.status} | Prompt: {formatPrompt(selectedTask.prompt)}
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
              Showing lines {sliceStart + 1}-{sliceEnd} of {totalLines}{isFocused ? ' (Use ← → to switch tasks, b/f to page, ↑/↓ to scroll)' : ''}
            </Text>
          )}
        </Box>
      ) : (
        <Text color="gray" marginTop={1}>
          No background tasks running.
        </Text>
      )}
    </Box>
  );
};

const App = () => {
    // --- STATE ---
    const [frozenMessages, setFrozenMessages] = useState<Message[]>([]);
    const [activeMessages, setActiveMessages] = useState<Message[]>([]);
    const [query, setQuery] = useState('');
    const [selectedKernel, setSelectedKernel] = useState<Kernel>(Kernel.CLAUDE_CODE);
    const [selectedDriver, setSelectedDriver] = useState<Driver>(Driver.MANUAL);
    const [focusedControl, setFocusedControl] = useState<'input' | 'kernel' | 'driver' | 'tasks'>('input');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const conversationLogRef = useRef<LogMessage[]>([]);
    const pendingUserInputsRef = useRef<Message[]>([]);
    const isProcessingQueueRef = useRef(false);
    const streamAbortControllerRef = useRef<AbortController | null>(null);
    const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastTokenAtRef = useRef<number>(0);
    const messageIdRef = useRef(0);

    const nextMessageId = () => {
        messageIdRef.current += 1;
        return messageIdRef.current;
    };

    const clearStreamWatchdog = () => {
        if (streamTimeoutRef.current) {
            clearInterval(streamTimeoutRef.current);
            streamTimeoutRef.current = null;
        }
    };

    const pushSystemMessage = (content: string) => {
        const systemMessage: Message = {
            id: Date.now(),
            role: 'system',
            content,
            isBoxed: true,
        };
        setActiveMessages(prev => [...prev, systemMessage]);
        setFrozenMessages(prev => [...prev, systemMessage]);
        conversationLogRef.current.push({ role: 'system', content });
    };

    // --- EFFECTS & HOOKS ---
    useEffect(() => {
        const requiredEnvVars = [
            'ANTHROPIC_API_KEY',
            'ANTHROPIC_BASE_URL',
            'ANTHROPIC_MODEL',
        ];
        const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

        if (missingEnvVars.length > 0) {
            console.error(`Error: Missing required environment variables: ${missingEnvVars.join(', ')}`);
            console.error('Please ensure these are set in your .env file or environment.');
            process.exit(1);
        }

        fs.writeFileSync(LOG_FILE, '');
        addLog('--- Application Started ---');

        const interval = setInterval(() => {
            setTasks(taskManager.getAllTasks());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    useInput((input, key) => {
        if (key.tab) {
            if (focusedControl === 'input') setFocusedControl('kernel');
            else if (focusedControl === 'kernel') setFocusedControl('driver');
            else if (focusedControl === 'driver') setFocusedControl('tasks');
            else if (focusedControl === 'tasks') setFocusedControl('input');
        }
    });

    const runStreamForUserMessage = async (userMessage: Message): Promise<void> => {
        const normalizedUserMessage: Message = { ...userMessage, isPending: false };
        addLog(`[Stream] Starting turn with user content: ${normalizedUserMessage.content.replace(/\s+/g, ' ').slice(0, 120)}`);
        setIsStreaming(true);

        // Render: keep only pending placeholders then append current user message
        setActiveMessages(prev => {
            const pendingOnly = prev.filter(msg => msg.isPending);
            return [...pendingOnly, normalizedUserMessage];
        });

        conversationLogRef.current.push({ role: 'user', content: normalizedUserMessage.content });

        const assistantMessageId = nextMessageId();
        const assistantPlaceholder: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
        };

        setActiveMessages(prev => [...prev, assistantPlaceholder]);

        const assistantLogIndex = conversationLogRef.current.push({ role: 'assistant', content: '' }) - 1;

        const abortController = new AbortController();
        streamAbortControllerRef.current = abortController;
        lastTokenAtRef.current = Date.now();

        clearStreamWatchdog();
        let timedOut = false;
        streamTimeoutRef.current = setInterval(() => {
            if (Date.now() - lastTokenAtRef.current > STREAM_TOKEN_TIMEOUT_MS) {
                addLog('Stream timeout reached (10s without new tokens). Aborting request.');
                timedOut = true;
                abortController.abort();
            }
        }, 1000);

        let assistantContent = '';
        let assistantSucceeded = false;

        try {
            addLog(`Calling AI API with model: ${modelName}`);
            const messagesPayload = conversationLogRef.current
                .slice(0, assistantLogIndex)
                .map(({ role, content }) => ({ role, content }));

            const result = await streamText({
                model: openrouter.chat(modelName),
                messages: messagesPayload,
                abortSignal: abortController.signal,
            });

            addLog('AI stream started.');

            for await (const delta of result.textStream) {
                assistantContent += delta;
                lastTokenAtRef.current = Date.now();
                setActiveMessages(prev =>
                    prev.map(msg =>
                        msg.id === assistantMessageId ? { ...msg, content: assistantContent } : msg
                    )
                );
                conversationLogRef.current[assistantLogIndex] = { role: 'assistant', content: assistantContent };
            }

            assistantSucceeded = true;
            addLog('[Stream] Completed assistant response.');
        } catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error);
            const displayMessage = timedOut ? 'Stream timeout (10s without response).' : rawMessage;
            addLog(`[Stream] Error: ${displayMessage}`);
            conversationLogRef.current.splice(assistantLogIndex, 1);
            setActiveMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
            pushSystemMessage(`Error: ${displayMessage}`);
        } finally {
            clearStreamWatchdog();
            streamAbortControllerRef.current = null;
            setIsStreaming(false);
        }

        const completedMessages: Message[] = [{ ...normalizedUserMessage, isPending: false }];
        if (assistantSucceeded) {
            conversationLogRef.current[assistantLogIndex] = { role: 'assistant', content: assistantContent };
            completedMessages.push({
                id: assistantMessageId,
                role: 'assistant',
                content: assistantContent,
            });
        }
        setFrozenMessages(prev => [...prev, ...completedMessages]);

        setActiveMessages(prev => prev.filter(msg => msg.isPending));

        if (!isProcessingQueueRef.current) {
            await flushPendingQueue();
        }
    };

    const flushPendingQueue = async () => {
        if (pendingUserInputsRef.current.length === 0) {
            return;
        }

        isProcessingQueueRef.current = true;

        try {
            while (pendingUserInputsRef.current.length > 0) {
                const batch = pendingUserInputsRef.current.splice(0, pendingUserInputsRef.current.length);
                const batchSummary = batch.map(msg => msg.content.replace(/\s+/g, ' ').trim()).join(' | ');
                addLog(`[Queue] Flushing ${batch.length} queued input(s): ${batchSummary}`);

                const idsToRemove = new Set(batch.map(msg => msg.id));
                setActiveMessages(prev => prev.filter(msg => !(msg.isPending && idsToRemove.has(msg.id))));

                const mergedContent = batch.map(msg => msg.content).join('\n');
                const trimmed = mergedContent.trim();

                if (trimmed.length === 0) {
                    addLog('[Queue] Merged content was empty after trimming; skipping send.');
                    continue;
                }

                const mergedMessage: Message = {
                    id: nextMessageId(),
                    role: 'user',
                    content: mergedContent,
                };

                await runStreamForUserMessage(mergedMessage);
            }
        } finally {
            isProcessingQueueRef.current = false;
        }
    };

    // --- HANDLERS ---
    const handleSubmit = async (userInput: string) => {
        addLog('--- New Submission ---');
        if (!userInput) return;

        if (userInput.startsWith('/task ')) {
            const prompt = userInput.substring(6);
            taskManager.createTask(prompt);
            setQuery('');
            return;
        }

        const newUserMessage: Message = {
            id: nextMessageId(),
            role: 'user',
            content: userInput,
        };

        setQuery('');

        if (isStreaming || isProcessingQueueRef.current) {
            addLog(`Stream in progress. Queuing user input: ${userInput}`);
            pendingUserInputsRef.current.push({ ...newUserMessage });
            setActiveMessages(prev => [...prev, { ...newUserMessage, isPending: true }]);
            return;
        }

        try {
            await runStreamForUserMessage(newUserMessage);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addLog(`Submission error: ${message}`);
            pushSystemMessage(`Error: ${message}`);
        }
    };

    // --- RENDER ---
    const staticItems = [
        <Box key="welcome-screen-wrapper" flexDirection="column"><WelcomeScreen /><Newline /></Box>,
        ...frozenMessages.map(msg => <MessageComponent key={msg.id} message={msg} />)
    ];

	return (
		<Box flexDirection="column">
            <Static items={staticItems}>
                {item => item}
            </Static>
            <ActiveHistory messages={activeMessages} />

            <TaskList tasks={tasks} isFocused={focusedControl === 'tasks'} />

            <Box borderStyle="single" borderColor={focusedControl === 'input' ? 'blue' : 'gray'} paddingX={1}>
                <TextInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleSubmit}
                    placeholder="Type your message... or use /task <prompt>"
                    focus={focusedControl === 'input'}
                />
            </Box>


            <Box paddingX={1} flexDirection="column">
                <OptionGroup
                  title="Kernel"
                  options={Object.values(Kernel)}
                  selectedValue={selectedKernel}
                  onSelect={setSelectedKernel}
                  isFocused={focusedControl === 'kernel'}
                />
                <OptionGroup
                  title="Driver"
                  options={Object.values(Driver)}
                  selectedValue={selectedDriver}
                  onSelect={setSelectedDriver}
                  isFocused={focusedControl === 'driver'}
                />

                <Text color="gray">(Press [Tab] to switch between controls)</Text>
            </Box>
		</Box>
	);
};

// --- Render ---
render(<App />);
