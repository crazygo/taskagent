import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { AgentPermissionOption, AgentPermissionPromptProps } from './AgentPermissionPrompt.types.js';

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

    useInput(
        (_input, key) => {
            if (!isFocused) {
                return;
            }
            if (key.leftArrow || key.upArrow) {
                setSelectedIndex(prev => (prev + options.length - 1) % options.length);
            } else if (key.rightArrow || key.downArrow || key.tab) {
                setSelectedIndex(prev => (prev + 1) % options.length);
            } else if (key.return) {
                const option = options[selectedIndex];
                if (option) {
                    onSubmit(option.key);
                }
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
