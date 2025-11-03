import React from 'react';
import { Box, Text } from 'ink';
import type { ViewDriverProps } from '../drivers/types.js';

const StackAgentView: React.FC<ViewDriverProps> = ({ label, isActive }) => (
    <Box display={isActive ? 'flex' : 'none'}>
        <Text>{label} View is active.</Text>
    </Box>
);

export default StackAgentView;
