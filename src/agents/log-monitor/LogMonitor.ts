import { PromptAgent, type AgentContext, type AgentStartContext, type AgentStartSinks } from '../../agent/types.js';
import { buildPromptAgentStart } from '../../agent/runtime/runPromptAgentStart.js';
import type { TaskEvent } from '../../types.js';

/**
 * LogMonitor - Prompt-driven agent that monitors project signals for changes
 * Primary source: debug.log tail. Also scans latest task log and (if available) recent git diff.
 * Self-manages loop via prompt instructions.
 */
export class LogMonitor extends PromptAgent {
    readonly id = 'log-monitor';
    readonly description = 'Monitor logs (debug.log + task logs) and git diff to emit concise status/risk updates';

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

        // Secondary sources (optional, best-effort)
        const logsDir = context.workspacePath
            ? `${context.workspacePath}/logs`
            : 'logs';

        return `
You are a project log and health monitoring agent.${workspaceHint}

Your goals:
- Primary: Monitor the file ${logPath} every ${this.intervalSec}s and read the last ${this.tailLines} lines.
- Secondary (best-effort):
  - Check the most recent task log under ${logsDir}/*.log and scan the last ${this.tailLines} lines.
  - If a shell (Bash) tool is available and the workspace is a git repo, run a small git diff to detect recent changes since the previous cycle.

Looping policy (self-managed, keep short):
1) Maintain a small in-memory snapshot for each source (debug.log tail, latest task log tail, recent git diff summary).
2) On each cycle, fetch fresh data for each source and compare with the previous snapshot.
3) Only when a meaningful change is detected, emit a single concise event line using the format below.
4) Otherwise, stay quiet. Do not emit anything if there’s no change.

Output format (exactly one line per event):
  [EVENT:info] <concise change summary>
  [EVENT:warning] <concise risk or anomaly>
  [EVENT:error] <concise failure or critical issue>

Guidelines:
- Prefer signal-to-noise: a single sentence with the highest-value change.
- Examples of useful signals: new errors/warnings in logs, failed task runs, unusually long idle periods, large/risky git diffs touching tests or critical files.
- If Bash/git is unavailable, skip git checks silently.
- Do NOT print thoughts, steps, or raw contents; only emit event lines when warranted.

User instruction: ${userInput}

Begin the monitoring loop now. Continue until stopped or timed out. Emit events only on change.
`.trim();
    }

    getTools(): string[] {
        // Read/Glob are sufficient for log scanning; Bash enables small git diff checks; Grep optional.
        return ['Read', 'Glob', 'Bash', 'Grep'];
    }

    /**
     * Provide a unified start() using the default PromptAgent streaming wrapper.
     */
    start(userInput: string, ctx: AgentStartContext, sinks: AgentStartSinks) {
        const starter = buildPromptAgentStart({
            getPrompt: (input: string, c: { sourceTabId: string; workspacePath?: string }) => this.getPrompt(input, c as AgentContext),
            getModel: () => this.getModel?.(),
            // Reuse parseOutput for streaming event emission if available
            parseOutput: this.parseOutput?.bind(this),
        });
        return starter(userInput, ctx, sinks);
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
