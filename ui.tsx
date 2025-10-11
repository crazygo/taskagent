
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import React, {useState, useCallback, useEffect} from 'react';
import {render, Text, Box, Newline, Static} from 'ink';
import TextInput from 'ink-text-input';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

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
const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
});

// --- Model Configuration ---
const modelName = process.env.OPENROUTER_MODEL_NAME || 'google/gemini-flash';

// --- Types ---
type MessageType = 'user' | 'assistant' | 'system';

interface Message {
    id: number;
    role: MessageType;
    content: string;
    isBoxed?: boolean;
}

// --- Components ---

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

const App = () => {
    const [frozenMessages, setFrozenMessages] = useState<Message[]>([]);
    const [activeMessages, setActiveMessages] = useState<Message[]>([]);
    const [query, setQuery] = useState('');

    useEffect(() => {
        fs.writeFileSync(LOG_FILE, '');
        addLog('--- Application Started ---');
    }, []);

    const handleSubmit = async (userInput: string) => {
        addLog('--- New Submission ---');
        if (!userInput) return;

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
                }}
            </Static>
            <ActiveHistory messages={activeMessages} />
			<Newline />
            <Box borderStyle="single" borderColor="blue">
                <TextInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleSubmit}
                    placeholder="Type your message..."
                />
            </Box>
		</Box>
	);
};

// --- Render ---
render(<App />);