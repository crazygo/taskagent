import React from 'react';
import { Box, Newline, Static, Text, useStdout } from 'ink';
import * as Types from '../types.js';
import { addLog } from '@taskagent/shared/logger';

/**
 * Thinking animation component - displays walking dots
 */
const ThinkingAnimation: React.FC = () => {
  const [frame, setFrame] = React.useState(0);
  const frames = ['Thinking   ', 'Thinking.  ', 'Thinking.. ', 'Thinking...'];
  
  React.useEffect(() => {
    addLog('[ThinkingAnimation] mounted');
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length);
    }, 300);
    return () => {
      clearInterval(timer);
      addLog('[ThinkingAnimation] unmounted');
    };
  }, []);

  return <Text color="gray" dimColor>{frames[frame]}</Text>;
};

interface MessageProps {
  message: Types.Message;
}

const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  const { stdout } = useStdout();
  const fullWidth = Math.max(1, stdout?.columns ?? 80);

  const pendingSuffix = message.queueState === 'queued'
    ? ' (queued)'
    : message.isPending
      ? ' (pending)'
      : '';
  const allReasoningLines = (message.reasoning ?? '')
    .split(/\r?\n/)
    .filter(line => line.length > 0);
  const reasoningLines = allReasoningLines.slice(Math.max(0, allReasoningLines.length - 3));
  const normalizedContent = message.role === 'assistant'
    ? (message.content ?? '').replace(/^\s+/, '').replace(/\s+$/, '')
    : (message.content ?? '').replace(/\s+$/, '');
  const contentLines = normalizedContent.split(/\r?\n/);
  const isWorkerMessage = message.variant === 'worker';

  // Skip rendering empty assistant placeholders
  if (message.role === 'assistant' && normalizedContent.length === 0 && reasoningLines.length === 0) {
    return null;
  }

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
    const content = message.content || '';
    
    return (
      <Box flexDirection="row" paddingLeft={2}>
        <Text color="gray" dimColor>○ {displayName}</Text>
        {description && <Text color="gray"> - {description}</Text>}
        {content && <Text color="gray"> - {content}</Text>}
      </Box>
    );
  }

  // Tool result: show tool completion with duration
  if (message.role === 'tool_result') {
    const displayName = message.toolName || 'Tool';
    const toolIdShort = message.toolId ? ` ${message.toolId.slice(5, 10)}` : '';

    return (
      <Box paddingLeft={2}>
        {message.toolIsError ? <Text color="red">✘ {displayName} id:{toolIdShort}</Text> : <Text color="gray" dimColor>✓</Text>}
        {message.toolIsError && message.content && <Text color="gray"> - {message.content}</Text>}
      </Box>
    );
  }

  let prefix = '';
  let textColor: 'white' | 'gray' | 'yellow' | 'cyan' | undefined;
  const boxProps: Record<string, unknown> = {};

  if (message.role === 'assistant') {
    const looperLike = /^\[(Looper|AUTO)\]/.test(normalizedContent);
    prefix = looperLike ? '∞ ' : '✦ ';
    textColor = looperLike ? 'cyan' : undefined;
    if (isWorkerMessage) {
      textColor = 'gray';
    }
  } else if (message.role === 'system') {
    prefix = 'i ';
    textColor = 'yellow';
    if (message.isBoxed) {
      boxProps.borderStyle = 'round';
      boxProps.borderColor = 'red';
      boxProps.paddingX = 1;
    }
  }

  return (
    <Box {...boxProps} flexDirection="column" paddingTop={1} paddingBottom={0}>
      {reasoningLines.length > 0 && (
        <Text color="gray" italic>{'✦ Thoughts:'}</Text>
      )}
      {reasoningLines.map((line, index) => (
        <Text key={`${message.id}-reasoning-${index}`} color="gray" italic>
          {'│ '}{line || ' '}
        </Text>
      ))}
      {contentLines.map((line, index) => {
        const isFirstLine = index === 0;
        return (
          <Box key={`${message.id}-content-${index}`} flexDirection="row">
            {isFirstLine ? (
              <>
                <Text color={textColor} dimColor={isWorkerMessage}>{prefix.replace(/\s*$/, ' ')}</Text>
                <Text color={textColor} dimColor={isWorkerMessage}>{line || ' '}</Text>
                {pendingSuffix ? <Text color={textColor} dimColor={isWorkerMessage}>{pendingSuffix}</Text> : null}
              </>
            ) : (
              <>
                <Text>{prefix.replace(/./g, ' ')}</Text>
                <Text color={textColor} dimColor={isWorkerMessage}>{line || ' '}</Text>
              </>
            )}
          </Box>
        );
      })}
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
  sessionLabel?: string | null;
}

const WelcomeScreen = React.memo<WelcomeScreenProps>(({ modelName, workspacePath, sessionLabel }) => (
  <Box borderStyle="round" paddingX={2} flexDirection="column">
    <Box>
      <Box flexGrow={1} flexDirection="column">
        <Text>TaskAgent v0.0.1</Text>
        <Text>Agent Model: {modelName || 'Not Set'}</Text>
        <Text>Coder Model: {modelName || 'Not Set'}</Text>
        <Text>
          Working Directory: {workspacePath?.trim().length ? workspacePath : process.cwd()}
        </Text>
        <Text>
          Claude Session: {sessionLabel ?? 'Not Initialized'}
        </Text>
      </Box>
    </Box>
  </Box>
));

interface ChatPanelProps {
  frozenMessages: Types.Message[];
  activeMessages: Types.Message[];
  queuedPrompts?: Array<{ id: number; prompt: string }>;
  modelName: string;
  workspacePath?: string | null;
  positionalPromptWarning?: string | null;
  sessionLabel?: string | null;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ frozenMessages, activeMessages, queuedPrompts, modelName, workspacePath, positionalPromptWarning, sessionLabel }) => {
  const staticItems = [
    <Box key="welcome-screen-wrapper" flexDirection="column">
      <WelcomeScreen modelName={modelName} workspacePath={workspacePath} sessionLabel={sessionLabel} />
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
      {((activeMessages?.length ?? 0) > 0 || (queuedPrompts?.length ?? 0) > 0) && (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          {/* 1. Thinking animation - show when AI is responding */}
          {activeMessages.length > 0 && (
            <Box marginBottom={0}>
              <ThinkingAnimation />
            </Box>
          )}
          
          {/* 2. Current streaming messages */}
          <ActiveHistory messages={activeMessages} />
          
          {/* 3. Queued prompts list */}
          {(queuedPrompts?.length ?? 0) > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" dimColor>Queued:</Text>
              {(queuedPrompts ?? []).map((item) => (
                <Text key={item.id} dimColor>
                  - {item.prompt.substring(0, 60)}{item.prompt.length > 60 ? '...' : ''} (queued)
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}
    </>
  );
};

export { MessageComponent };
