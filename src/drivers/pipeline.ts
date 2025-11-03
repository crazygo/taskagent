import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

export interface AgentPipelineOverrides {
    systemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
    agents?: Record<string, AgentDefinition>;
}

export interface DriverPrepareResult {
    /**
     * When provided, replaces the original user prompt before it is
     * forwarded to the agent pipeline.
     */
    prompt?: string;
    /**
     * Overrides applied on top of manifest-level agent pipeline settings.
     */
    overrides?: AgentPipelineOverrides;
    /**
     * Optional flow identifier to route the request through a specific
     * pipeline configuration.
     */
    flowId?: string;
    /**
     * Optional debug log emitted by the driver-specific preparation step.
     */
    debugLog?: string;
}
