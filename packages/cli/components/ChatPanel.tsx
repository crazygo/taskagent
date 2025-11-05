import React from 'react';
import { Box, Newline, Static, Text, useStdout } from 'ink';
import * as Types from '../types.js';

interface MessageProps {
  message: Types.Message;
}

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  const { stdout } = useStdout();
  const fullWidth = Math.max(1, stdout?.columns ?? 80);

  const pendingSuffix = message.isPending ? ' (queued)' : '';
  const allReasoningLines = (message.reasoning ?? '')
    .split(/\r?\n/)
    .filter(line => line.length > 0);
  const reasoningLines = allReasoningLines.slice(Math.max(0, allReasoningLines.length - 3));
  const normalizedContent = message.role === 'assistant'
    ? (message.content ?? '').replace(/^\s+/, '')
    : (message.content ?? '');
  const contentLines = normalizedContent.split(/\r?\n/);

  if (message.role === 'user') {
    const renderLine = (line: string, index: number) => {
      const renderedPrefix = index === 0 ? '> ' : '  ';
      const suffix = index === 0 ? pendingSuffix : '';
      return (
        <Box
          key={`${message.id}-user-${index}`}
          flexDirection="row"
          width={fullWidth}
          paddingX={1}
          backgroundColor="gray"
        >
          <Text color="white">{renderedPrefix}</Text>
          <Text color="white">{line || ' '}</Text>
          {suffix ? <Text color="white">{suffix}</Text> : null}
          <Box flexGrow={1} />
        </Box>
      );
    };

    return (
      <Box flexDirection="column" width={fullWidth}>
        {contentLines.map((line, index) => renderLine(line, index))}
      </Box>
    );
  }

  // Tool use: show tool start with name and description
  if (message.role === 'tool_use') {
    const displayName = message.toolName || 'Tool';
    const description = message.toolDescription || '';
    const toolIdShort = message.toolId ? ` [${message.toolId.slice(0, 8)}]` : '';
    
    return (
      <Box flexDirection="row">
        <Text color="cyan">&gt; {displayName}</Text>
        {description && <Text color="gray"> - {description}</Text>}
        {message.toolId && <Text color="gray" dimColor>{toolIdShort}</Text>}
      </Box>
    );
  }

  // Tool result: show tool completion with duration
  if (message.role === 'tool_result') {
    const displayName = message.toolName || 'Tool';
    const duration = message.durationMs 
      ? ` (${(message.durationMs / 1000).toFixed(1)}s)` 
      : '';
    
    return (
      <Box>
        <Text color="green">✓ {displayName} completed{duration}</Text>
      </Box>
    );
  }

  let prefix = '';
  let textColor: 'white' | 'gray' | 'yellow' | undefined;
  const boxProps: Record<string, unknown> = {};

  if (message.role === 'assistant') {
    prefix = '✦ ';
    textColor = undefined;
  } else if (message.role === 'system') {
    prefix = '[i] ';
    textColor = 'yellow';
    if (message.isBoxed) {
      boxProps.borderStyle = 'round';
      boxProps.borderColor = 'red';
      boxProps.paddingX = 1;
    }
  }

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
  workspacePath?: string | null;
}

const WelcomeScreen = React.memo<WelcomeScreenProps>(({ modelName, workspacePath }) => (
  <Box borderStyle="round" paddingX={2} flexDirection="column">
    <Box>
      <Box flexGrow={1} flexDirection="column">
        <Text>TaskAgent v0.0.1</Text>
        <Text>Agent Model: {modelName || 'Not Set'}</Text>
        <Text>Coder Model: {modelName || 'Not Set'}</Text>
        <Text>
          Working Directory: {workspacePath?.trim().length ? workspacePath : process.cwd()}
        </Text>
      </Box>
    </Box>
  </Box>
));

interface ChatPanelProps {
  frozenMessages: Types.Message[];
  activeMessages: Types.Message[];
  modelName: string;
  workspacePath?: string | null;
  positionalPromptWarning?: string | null;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ frozenMessages, activeMessages, modelName, workspacePath, positionalPromptWarning }) => {
  const staticItems = [
    <Box key="welcome-screen-wrapper" flexDirection="column">
      <WelcomeScreen modelName={modelName} workspacePath={workspacePath} />
      {positionalPromptWarning ? (
        <>
          <Newline />
          <Box borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0} flexDirection="column">
            <Text color="yellow">{positionalPromptWarning}</Text>
          </Box>
        </>
      ) : null}
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
