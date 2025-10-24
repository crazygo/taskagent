import React from 'react';
import { Box, Newline, Static, Text } from 'ink';
import * as Types from '../types.ts';

interface MessageProps {
  message: Types.Message;
}

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  let prefix = '';
  let textColor: 'white' | 'gray' | 'yellow' = 'white';
  let boxProps = {} as Record<string, unknown>;

  if (message.role === 'user') {
    prefix = '> ';
    textColor = 'white';
  } else if (message.role === 'assistant') {
    prefix = '✦ ';
    textColor = 'white';
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
  const allReasoningLines = (message.reasoning ?? '')
    .split(/\r?\n/)
    .filter(line => line.length > 0);
  const reasoningLines = allReasoningLines.slice(Math.max(0, allReasoningLines.length - 3));
  const normalizedContent = message.role === 'assistant'
    ? (message.content ?? '').replace(/^\s+/, '')
    : (message.content ?? '');
  const contentLines = normalizedContent.split(/\r?\n/);

  return (
    <Box {...boxProps} flexDirection="column">
      {reasoningLines.length > 0 && (
        <Text color="gray" italic>{'✦ Thoughts:'}</Text>
      )}
      {reasoningLines.map((line, index) => (
        <Text key={`${message.id}-reasoning-${index}`} color="gray" italic>
          {'│ '}{line || ' '}
        </Text>
      ))}
      {contentLines.map((line, index) => (
        <Text key={`${message.id}-content-${index}`} color={textColor}>
          {index === 0 ? prefix.replace(/\s*$/, ' ') : ''}{line || ' '}{index === 0 ? pendingSuffix : ''}
        </Text>
      ))}
    </Box>
  );
};

interface HistoryProps {
  messages: Types.Message[];
}

const ActiveHistory: React.FC<HistoryProps> = ({ messages }) => (
  <Box flexDirection="column">
    {messages.map(msg => (
      <MessageComponent key={`active-${msg.id}`} message={msg} />
    ))}
  </Box>
);

interface WelcomeScreenProps {
  modelName: string;
}

const WelcomeScreen = React.memo<WelcomeScreenProps>(({ modelName }) => (
  <Box borderStyle="round" paddingX={2} flexDirection="column">
    <Box>
      <Box flexGrow={1} flexDirection="column">
        <Text>TaskAgent v0.0.1</Text>
        <Text>Agent Model: {modelName || 'Not Set'}</Text>
        <Text>Coder Model: {modelName || 'Not Set'}</Text>
        <Text>Working Directory: {process.cwd()}</Text>
      </Box>
    </Box>
  </Box>
));

interface ChatPanelProps {
  frozenMessages: Types.Message[];
  activeMessages: Types.Message[];
  modelName: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ frozenMessages, activeMessages, modelName }) => {
  const staticItems = [
    <Box key="welcome-screen-wrapper" flexDirection="column">
      <WelcomeScreen modelName={modelName} />
      <Newline />
    </Box>,
    ...frozenMessages.map(msg => (
      <MessageComponent key={`frozen-${msg.id}`} message={msg} />
    )),
  ];

  return (
    <>
      <Static items={staticItems}>
        {item => item}
      </Static>
      <ActiveHistory messages={activeMessages} />
    </>
  );
};

export { MessageComponent };
