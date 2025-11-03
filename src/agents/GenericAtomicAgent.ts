import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { AtomicAgent, type AgentContext } from '../agent/types.js';

/**
 * GenericAtomicAgent - Wrapper for AgentDefinition as AtomicAgent instance
 * Used to convert .agent.md configurations into AtomicAgent instances
 */
export class GenericAtomicAgent extends AtomicAgent {
    readonly id: string;
    readonly description: string;
    private readonly promptTemplate: string;
    private readonly tools?: string[];
    private readonly model?: string;

    constructor(name: string, definition: AgentDefinition) {
        super();
        this.id = name;
        this.description = definition.description;
        this.promptTemplate = definition.prompt;
        this.tools = definition.tools;
        this.model = definition.model as string | undefined;
    }

    getPrompt(userInput: string, context: AgentContext): string {
        // Replace common template variables
        return this.promptTemplate
            .replace(/\{\{USER_INPUT\}\}/g, userInput)
            .replace(/\{\{WORKSPACE_PATH\}\}/g, context.workspacePath || '');
    }

    getTools(): string[] {
        return this.tools || [];
    }

    getModel(): string {
        return this.model || '';
    }
}
