import { PromptAgent, type AgentContext, type AgentStartContext, type AgentStartSinks } from '../../agent/types.js';
import { buildPromptAgentStart } from '../../agent/runtime/runPromptAgentStart.js';
import crypto from 'crypto';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { TaskEvent } from '../../types.js';

/**
 * LogMonitor - Prompt-driven agent that monitors project signals for changes
 * Primary source: debug.log tail. Also scans latest task log and (if available) recent git diff.
 * Self-manages loop via prompt instructions.
 */
export class LogMonitor extends PromptAgent {
    readonly id = 'log-monitor';
    readonly description = 'Multi-module monitor (debug.log, task logs, git diff) with mutual cross-checking and consensus before emitting events';

    constructor(
        private readonly logFilePath: string = 'debug.log',
        private readonly tailLines: number = 100,
        private readonly intervalSec: number = 30
    ) {
        super();
    }

    getPrompt(userInput: string, context: AgentContext): string {
        // Pass through user instruction as the actual user message.
        return userInput;
    }

        /**
         * Provide the monitoring instructions as a system prompt (preset + append).
         * Keep paths generic to avoid coupling to dynamic workspace context at this layer.
         */
    getSystemPrompt(context?: AgentContext): { type: 'preset'; preset: 'claude_code'; append: string } {
        const cwdNote = context?.workspacePath 
            ? `\n\nIMPORTANT: You are operating in workspace: ${context.workspacePath}\nUse relative paths or ensure all file operations target this directory.`
            : '';
        const instructions = `
You are the Coordinator of a multi-module project health monitor.${cwdNote}

Sources and sub-agents you can call:
- tail_debug: tail the last ${this.tailLines} lines of ${this.logFilePath} and extract signals (errors/warnings, notable events, timestamps).
- task_log: scan the most recent logs/*.log (last ${this.tailLines} lines) for failures, warnings, or anomalies.
- git_diff: if Bash/git are available, get a small summary of recent changes since the previous cycle (files touched, size, risk hints).

Mutual supervision and consensus:
1) Each suspected signal must be cross-checked by at least one other sub-agent when applicable (e.g., tail_debug ↔ task_log; git_diff ↔ tail_debug) before emitting.
2) Emit only when:
   - Two sources corroborate the same risk/change; or
   - One source reports a high-severity failure where cross-check is not applicable (e.g., crash stack trace), in which case emit immediately.
3) Maintain a tiny in-memory snapshot per source to avoid duplicate emits. Only emit on meaningful deltas.

Loop policy (short-running steps, repeat until stopped):
1) Poll tail_debug. If suspicious, ask task_log to quickly verify; if code changes are suspected, consult git_diff.
2) Poll task_log. If suspicious, ask tail_debug for corroboration; optionally consult git_diff if test/CI files changed.
3) Poll git_diff. If risky areas changed (tests, critical files), ask tail_debug/task_log to check for new errors.
4) If consensus or high severity is met and this was not emitted before, emit exactly one event line.

Output format (exactly one line per event):
  [EVENT:info] <concise change summary>
  [EVENT:warning] <concise risk or anomaly>
  [EVENT:error] <concise failure or critical issue>

Guidelines:
- Keep outputs terse and high-signal. No thoughts, no raw dumps.
- If git is unavailable, skip it silently.
- Respect consensus logic; otherwise stay quiet.

Begin now.`.trim();
        return { type: 'preset', preset: 'claude_code', append: instructions } as const;
    }

    getTools(): string[] {
        // Base tools available to the coordinator. Sub-agents declare their own minimal tools.
        return ['Read', 'Glob', 'Bash', 'Grep'];
    }

    /**
     * Provide sub-agent definitions to enable mutual supervision.
     * Keep them minimal and tool-scoped; the coordinator orchestrates calls and consensus.
     */
    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
        const n = this.tailLines;
        const debugPath = this.logFilePath;
        return {
            tail_debug: {
                description: `Read last ${n} lines of ${debugPath} and extract high-signal findings`,
                tools: ['Read', 'Grep'],
                prompt: [
                    `Goal: Tail the last ${n} lines of ${debugPath}.`,
                    `Identify:`,
                    `- New error/warning lines (counts, last timestamp)`,
                    `- Any crash/stack trace starts`,
                    `- Notable lifecycle events (start/stop)`,
                    `Output a terse summary only, no raw dumps.`,
                ].join('\n'),
            },
            task_log: {
                description: `Scan latest logs/*.log (last ${n} lines) for failures/warnings`,
                tools: ['Glob', 'Read', 'Grep'],
                prompt: [
                    `Goal: Find the most recent file matching logs/*.log, read the last ${n} lines.`,
                    `Extract: new failures, test errors, warnings, or retries; include last timestamp.`,
                    `Output a concise status/risk summary only.`,
                ].join('\n'),
            },
            git_diff: {
                description: `Summarize small recent git changes and basic risk hints`,
                tools: ['Bash'],
                prompt: [
                    `If git is available and repo present:`,
                    `- Run a minimal diff or shortlog since last cycle (choose a cheap command).`,
                    `- Summarize #files, key paths touched (tests, ui.tsx, src/** critical).`,
                    `If git is unavailable, reply: 'git-unavailable'.`,
                    `Keep it one short sentence.`,
                ].join('\n'),
            },
        };
    }

    /**
     * Run monitoring loop for 10 minutes. After each cycle completes, wait intervalSec then start the next.
     * We reuse the prompt-driven execution per cycle and suppress per-cycle onCompleted to avoid
     * finishing the overall monitor prematurely. A final onCompleted is emitted after the loop.
     */
    start(userInput: string, ctx: AgentStartContext, sinks: AgentStartSinks) {
        const controller = new AbortController();
        const sessionId = ctx.session?.id ?? crypto.randomUUID();
        const starter = buildPromptAgentStart({
            getPrompt: (input: string, c: { sourceTabId: string; workspacePath?: string }) => this.getPrompt(input, c as AgentContext),
            getSystemPrompt: () => this.getSystemPrompt(ctx as AgentContext),
            getAgentDefinitions: () => this.getAgentDefinitions?.(),
            getModel: () => this.getModel?.(),
            parseOutput: this.parseOutput?.bind(this),
        });

        const deadline = Date.now() + 10 * 60 * 1000; // 10 minutes
        const intervalMs = Math.max(0, this.intervalSec * 1000);

        const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

        const run = async () => {
            let cycleCount = 0;
            try {
                while (Date.now() < deadline && !controller.signal.aborted) {
                    cycleCount++;
                    const remainingMs = deadline - Date.now();
                    const remainingMin = (remainingMs / 60000).toFixed(1);
                    
                    // Notify cycle start
                    try {
                        sinks.onEvent?.({
                            level: 'info',
                            message: `[Monitor] Cycle #${cycleCount} started (${remainingMin} min remaining)`,
                            ts: Date.now(),
                        });
                    } catch {}

                    // Wrap sinks to know when a cycle ends and to avoid per-cycle completion propagation
                    let resolveCycle: (value?: unknown) => void;
                    const cycleDone = new Promise(r => { resolveCycle = r; });

                    const handle = starter(userInput, ctx, {
                        onText: (chunk: string) => {
                            try { sinks.onText(chunk); } catch {}
                        },
                        onReasoning: (chunk?: string) => {
                            try { sinks.onReasoning?.(chunk ?? ''); } catch {}
                        },
                        onEvent: (e) => {
                            try { sinks.onEvent?.(e); } catch {}
                        },
                        // Suppress per-cycle completion to keep monitor running; resolve internal promise instead
                        onCompleted: (_full: string) => {
                            try { resolveCycle(); } catch {}
                        },
                        onFailed: (error: string) => {
                            try { sinks.onFailed?.(error); } catch {}
                            try { resolveCycle(); } catch {}
                        },
                        canUseTool: sinks.canUseTool,
                    });

                    // Wait for this cycle to complete
                    try { await cycleDone; } catch {}

                    // Notify cycle completion
                    try {
                        sinks.onEvent?.({
                            level: 'info',
                            message: `[Monitor] Cycle #${cycleCount} completed`,
                            ts: Date.now(),
                        });
                    } catch {}

                    // Best-effort cancel current cycle if external cancel requested
                    if (controller.signal.aborted) {
                        try { handle.cancel(); } catch {}
                        break;
                    }

                    // Wait interval before next cycle
                    if (intervalMs > 0 && Date.now() < deadline) {
                        try {
                            sinks.onEvent?.({
                                level: 'info',
                                message: `[Monitor] Waiting ${this.intervalSec}s before next cycle...`,
                                ts: Date.now(),
                            });
                        } catch {}
                        
                        const until = Date.now() + intervalMs;
                        while (Date.now() < until && !controller.signal.aborted) {
                            const remain = until - Date.now();
                            await sleep(Math.min(250, Math.max(0, remain))); // small sleeps, responsive to abort
                        }
                    }
                }
            } finally {
                // Final completion notice after monitoring window ends or cancel occurs
                try {
                    sinks.onEvent?.({
                        level: 'info',
                        message: `[Monitor] Completed after ${cycleCount} cycles`,
                        ts: Date.now(),
                    });
                } catch {}
                try { sinks.onCompleted?.('[monitor] completed'); } catch {}
            }
        };

        void run();

        return {
            cancel: () => controller.abort(),
            sessionId,
        };
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
