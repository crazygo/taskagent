import { PromptAgent, type AgentContext } from '../../agent/types.js';
import type { TaskEvent } from '../../types.js';

/**
 * LogMonitor - Atomic agent that monitors a log file for changes
 * Self-manages loop via prompt instructions
 */
export class LogMonitor extends PromptAgent {
    readonly id = 'log-monitor';
    readonly description = 'Monitor log file for changes and emit natural language summaries';

    constructor(
        private readonly logFilePath: string = 'debug.log',
        private readonly tailLines: number = 100,
        private readonly intervalSec: number = 30
    ) {
        super();
    }

    getPrompt(userInput: string, context: AgentContext): string {
        const workspaceHint = context.workspacePath 
            ? `\nWorkspace: ${context.workspacePath}` 
            : '';
        
        // Use absolute path if workspace is provided, otherwise relative
        const logPath = context.workspacePath 
            ? `${context.workspacePath}/${this.logFilePath}`
            : this.logFilePath;

        return `
You are a log monitoring agent. Your task:
- Monitor the file: ${logPath}${workspaceHint}
- Every ${this.intervalSec} seconds, read the last ${this.tailLines} lines
- Compare with your previous snapshot (keep it in your working memory)
- Emit a natural language summary ONLY when you detect changes
- Use this exact format for output:
  [EVENT:info] <your message about the change>
  [EVENT:warning] <your message if there's a concern>
  [EVENT:error] <your message if there's a critical issue>
- Do NOT output intermediate steps or thinking process
- Do NOT emit events if there are no changes

User instruction: ${userInput}

Start monitoring now. When you detect changes, emit event lines and continue the loop until instructed to stop or timeout.
`.trim();
    }

    getTools(): string[] {
        return ['Read', 'Glob'];
    }

    /**
     * Parse agent output to extract structured events
     * Format: [EVENT:level] message
     */
    parseOutput(rawOutput: string): TaskEvent[] {
        const events: TaskEvent[] = [];
        const lines = rawOutput.split('\n');
        
        for (const line of lines) {
            const match = line.match(/^\[EVENT:(info|warning|error)\]\s*(.+)$/i);
            if (match) {
                const level = match[1]!.toLowerCase() as 'info' | 'warning' | 'error';
                const message = match[2]!.trim();
                events.push({
                    level,
                    message,
                    ts: Date.now(),
                });
            }
        }
        
        return events;
    }
}
