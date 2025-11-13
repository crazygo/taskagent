import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

import type { AgentPermissionOption, AgentPermissionPromptProps } from './AgentPermissionPrompt.types.js';
import { useKeypress, type Key } from '../src/hooks/useKeypress.js';

export const AgentPermissionPromptComponent: React.FC<AgentPermissionPromptProps> = ({ prompt, onSubmit, isFocused }) => {
    const options: Array<{ key: AgentPermissionOption; label: string }> = prompt.hasSuggestions
        ? [
              { key: 'allow', label: 'Allow' },
              { key: 'deny', label: 'Deny' },
              { key: 'always', label: 'Always Allow' },
          ]
        : [
              { key: 'allow', label: 'Allow' },
              { key: 'deny', label: 'Deny' },
          ];

    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        setSelectedIndex(0);
    }, [prompt.requestId, prompt.hasSuggestions]);

    useKeypress(
        (key: Key) => {
            if (!isFocused) return;
            const name = key.name;
            if (name === 'left' || name === 'up') {
                setSelectedIndex(prev => (prev + options.length - 1) % options.length);
            } else if (name === 'right' || name === 'down' || name === 'tab') {
                setSelectedIndex(prev => (prev + 1) % options.length);
            } else if (name === 'return' || name === 'enter') {
                const option = options[selectedIndex];
                if (option) onSubmit(option.key);
            }
        },
        { isActive: isFocused }
    );

    const summaryLines = prompt.summary.split('\n').filter(line => line.trim().length > 0).slice(0, 20);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
            <Text color="cyan">{`Permission #${prompt.requestId} · ${prompt.toolName}`}</Text>
            <Text> </Text>
            {summaryLines.length === 0 ? (
                <Text color="gray">{'(empty input)'}</Text>
            ) : (
                summaryLines.map((line, index) => (
                    <Text key={`${prompt.requestId}-summary-${index}`} color="gray">
                        {line}
                    </Text>
                ))
            )}
            <Text> </Text>
            <Box flexDirection="row">
                {options.map((option, index) => (
                    <React.Fragment key={option.key}>
                        <Text inverse={index === selectedIndex}>{` ${option.label} `}</Text>
                        {index < options.length - 1 ? <Text> </Text> : null}
                    </React.Fragment>
                ))}
            </Box>
            <Text color="gray">
                {prompt.hasSuggestions
                    ? 'Use ←/→ to switch, Enter to confirm. "Always Allow" remembers this permission.'
                    : 'Use ←/→ to switch, Enter to confirm.'}
            </Text>
        </Box>
    );
};

export default AgentPermissionPromptComponent;
