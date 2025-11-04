export type AgentPermissionOption = 'allow' | 'deny' | 'always';

export interface AgentPermissionPromptState {
    requestId: number;
    toolName: string;
    summary: string;
    hasSuggestions: boolean;
}

export interface AgentPermissionPromptProps {
    prompt: AgentPermissionPromptState;
    onSubmit: (option: AgentPermissionOption) => void;
    isFocused: boolean;
}
