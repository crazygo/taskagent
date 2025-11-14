/**
 * AgentCallback - Observer interface for workflow lifecycle events
 * 
 * Inspired by ADK Callback pattern for extracting cross-cutting concerns
 * (observability, metrics, summarization) from core workflow logic.
 * 
 * Usage:
 * - Create callback class implementing this interface
 * - Attach to LoopAgent/SequentialAgent via addCallback()
 * - Callback receives lifecycle notifications
 * - Can listen to EventBus internally (hybrid pattern)
 */
export interface AgentCallback {
    /**
     * Called when an agent starts execution
     */
    onAgentStart?(agentId: string, context?: any): void;

    /**
     * Called when an agent uses a tool
     */
    onToolUse?(agentId: string, toolName: string, event: any): void;

    /**
     * Called when an agent emits text
     */
    onText?(agentId: string, chunk: string): void;

    /**
     * Called when an agent completes execution
     */
    onAgentEnd?(agentId: string, result: string): void;

    /**
     * Called when an agent fails
     */
    onAgentFailed?(agentId: string, error: string): void;

    /**
     * Called at the start of each loop iteration (LoopAgent only)
     */
    onIterationStart?(iteration: number, task: string): void;

    /**
     * Called at the end of each loop iteration (LoopAgent only)
     */
    onIterationEnd?(iteration: number, result: string): void;
}
