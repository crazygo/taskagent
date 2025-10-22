
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import React, {useState, useCallback, useEffect} from 'react';
import {render, Text, Box, Newline, Static, useInput} from 'ink';
import TextInput from 'ink-text-input';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { TaskManager, Task } from './task-manager';

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
      <Box width={10}><Text color={isFocused ? 'blue' : 'white'}>{title}:</Text></Box>
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

const TaskList: React.FC<{ tasks: Task[] }> = ({ tasks }) => {
  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text>Background Tasks</Text>
      {tasks.map(task => (
        <Box key={task.id} flexDirection="column">
          <Text>Task ID: {task.id}</Text>
          <Text>Status: {task.status}</Text>
          <Text>Prompt: {task.prompt}</Text>
          <Text>Output: {task.output}</Text>
        </Box>
      ))}
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
    const [focusedControl, setFocusedControl] = useState<'input' | 'kernel' | 'driver'>('input');
    const [tasks, setTasks] = useState<Task[]>([]);

    // --- EFFECTS & HOOKS ---
    useEffect(() => {
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
            else if (focusedControl === 'driver') setFocusedControl('input');
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
        ...frozenMessages
    ];

	return (
		<Box flexDirection="column">
            <Static items={staticItems}>
                {item => {
                    if (React.isValidElement(item)) {
                        return item;
                    }
                    return <MessageComponent key={item.id} message={item} />;
                }}\
            </Static>
            <ActiveHistory messages={activeMessages} />
			<Newline />

            <TaskList tasks={tasks} />
            <Newline />

            <Box borderStyle="single" borderColor={focusedControl === 'input' ? 'blue' : 'grey'}>
                <TextInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleSubmit}
                    placeholder="Type your message... or use /task <prompt>"
                    focus={focusedControl === 'input'}
                />


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
