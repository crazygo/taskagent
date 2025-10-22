
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import React, {useState, useCallback, useEffect, useRef} from 'react';
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
}

enum Kernel {
  CLAUDE_CODE = 'Claude Code',
  GEMINI = 'Gemini',
  CODEX = 'Codex',
}

enum Driver {
  MANUAL = '手动挡',
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
                <Text>Claude Code v2.0.13</Text>
                <Box height={8} justifyContent="center" alignItems="center">
                    <Text>Welcome back Shengliang!</Text>
                </Box>
                <Box height={5} justifyContent="center" alignItems="center">
                    <Text>[Robot]</Text>
                </Box>
                <Text>glm-4.5 - API Usage Billing</Text>
                <Text>/Users/admin/Codespaces/askman-dev/askgear</Text>
            </Box>
            <Box borderStyle="single" flexDirection="column" paddingX={1} flexGrow={2}>
                <Text color="yellow">Recent activity</Text>
                <Text>22h ago 你好</Text>
                <Text>1w ago  24 Point Game: Comprehensive User Stories & Design</Text>
                <Text>1w ago  Boosting Programming Efficiency: Tips and Strategies</Text>
                <Text>/resume for more</Text>
                <Newline />
                <Text color="yellow">What's new</Text>
                <Text>Fix @-mentioning MCP servers to toggle them on/off</Text>
                <Text>Improve permission checks for bash with inline env vars</Text>
                <Text>Fix ultrathink + thinking toggle</Text>
                <Text>/release-notes for more</Text>
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

    const content = (
        <Text color={textColor}>
            {prefix}{message.content}
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

const TaskList: React.FC<TaskListProps> = ({ tasks, isFocused }) => {
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const userSelectedRef = useRef(false); // Track if user has manually selected

  // Update selectedTaskIndex when tasks change
  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskIndex(0);
      userSelectedRef.current = false; // Reset user selection flag
    } else if (selectedTaskIndex >= tasks.length) {
      // If selected index is out of bounds (e.g., task was removed), select the new last one
      setSelectedTaskIndex(tasks.length - 1);
      userSelectedRef.current = false; // Selection was forced, not user-driven
    } else if (!userSelectedRef.current && tasks.length > 0) {
      // If no user selection yet, and tasks are present, default to the last one
      setSelectedTaskIndex(tasks.length - 1);
    }
  }, [tasks]); // Only depend on tasks

  // Input handling for left/right arrows to switch tabs
  useInput(
    (input, key) => {
      if (!isFocused || tasks.length === 0) {
        return;
      }

      if (key.leftArrow) {
        setSelectedTaskIndex(prevIndex => {
          userSelectedRef.current = true; // User made a selection
          return prevIndex > 0 ? prevIndex - 1 : tasks.length - 1;
        });
      } else if (key.rightArrow) {
        setSelectedTaskIndex(prevIndex => {
          userSelectedRef.current = true; // User made a selection
          return prevIndex < tasks.length - 1 ? prevIndex + 1 : 0;
        });
      }
    },
    { isActive: isFocused } // Only active when TaskList is focused
  );

  const selectedTask = tasks[selectedTaskIndex];

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
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Task ID: {selectedTask.id} | Status: {selectedTask.status}
          </Text>
          <Text>Prompt: {selectedTask.prompt}</Text>
          <Text>Output: {selectedTask.output}</Text>
        </Box>
      ) : (
        <Text color="gray" marginTop={1}>
          No background tasks running.
        </Text>
      )}

      {tasks.length > 1 && isFocused && (
        <Text color="gray" marginTop={1}>
          (使用 ← → 切换任务)
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

    // --- HANDLERS (Existing handleSubmit logic remains unchanged) ---
    const handleSubmit = async (userInput: string) => {
        addLog('--- New Submission ---');
        if (!userInput) return;

        if (userInput.startsWith('/task ')) {
            const prompt = userInput.substring(6);
            taskManager.createTask(prompt);
            setQuery('');
            return;
        }

        if (activeMessages.length > 0) {
            setFrozenMessages(prev => [...prev, ...activeMessages]);
        }

        addLog('User submitted input.');
        const newUserMessage: Message = {
            id: Date.now(),
            role: 'user',
            content: userInput,
        };

        setActiveMessages([newUserMessage]);
        setQuery('');

        try {
            addLog(`Calling AI API with model: ${modelName}`);
            const result = await streamText({
                model: openrouter.chat(modelName),
                messages: [...frozenMessages, newUserMessage].map(({id, isBoxed, ...rest}) => rest),
            });
            addLog('AI stream started.');
    
            const assistantMessageId = Date.now() + 1;
            const assistantPlaceholder: Message = { id: assistantMessageId, role: 'assistant', content: '' };
            setActiveMessages(prev => [...prev, assistantPlaceholder]);

            let contentBuffer = '';
            let lastRenderTime = 0;
            const renderInterval = 100; // ms

            const updateAssistantMessage = (newContent: string) => {
                setActiveMessages(prevMessages =>
                    prevMessages.map(msg =>
                        msg.id === assistantMessageId ? { ...msg, content: newContent } : msg
                    )
                );
            };

            for await (const delta of result.textStream) {
                contentBuffer += delta;
                const now = Date.now();
                if (now - lastRenderTime > renderInterval) {
                    updateAssistantMessage(contentBuffer);
                    lastRenderTime = now;
                }
            }

            updateAssistantMessage(contentBuffer);

            addLog('AI stream finished.');
        } catch (error) {
            const errorContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
            addLog(errorContent);
            const errorMessage: Message = {
                id: Date.now() + 1,
                role: 'system',
                content: errorContent,
                isBoxed: true,
            };
            setActiveMessages(prev => [...prev, errorMessage]);
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

            <Box borderStyle="single" borderColor={focusedControl === 'input' ? 'blue' : 'grey'}>
                <TextInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleSubmit}
                    placeholder="Type your message... or use /task <prompt>"
                    focus={focusedControl === 'input'}
                />
            </Box>


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
	);
};

// --- Render ---
render(<App />);
