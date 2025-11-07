import { PromptAgent, type AgentContext, type AgentStartContext, type AgentStartSinks } from '../runtime/types.js';
import { buildPromptAgentStart } from '../runtime/runPromptAgentStart.js';
import crypto from 'crypto';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { TaskEvent } from '@taskagent/core/types/TaskEvent.js';
import fs from 'fs';
import path from 'path';

const DEFAULT_LOG_PATH = path.join('logs', 'debug.log');

/**
 * LogMonitor - Prompt-driven agent that monitors project signals for changes
 * Primary source: logs/debug.log tail. Also scans latest task log and (if available) recent git diff.
 * Self-manages loop via prompt instructions.
 */
class LogMonitor extends PromptAgent {
    readonly id = 'log-monitor';
    readonly description = 'Multi-module monitor (logs/debug.log, task logs, git diff) with mutual cross-checking and consensus before emitting events';

    constructor(
        private readonly logFilePath: string = DEFAULT_LOG_PATH,
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
        const promptPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'system.prompt.md');
        let instructions = fs.readFileSync(promptPath, 'utf-8');

        instructions = instructions
            .replace('${this.tailLines}', String(this.tailLines))
            .replace('${this.logFilePath}', this.logFilePath);

        const cwdNote = context?.workspacePath
            ? `\n\nIMPORTANT: You are operating in workspace: ${context.workspacePath}\nUse relative paths or ensure all file operations target this directory.`
            : '';
        
        const finalInstructions = `${instructions}${cwdNote}`;

        return { type: 'preset', preset: 'claude_code', append: finalInstructions } as const;
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
                    `Output a terse summary only, no raw dumps.`
                ].join('\n'),
            },
            task_log: {
                description: `Scan latest logs/*.log (last ${n} lines) for failures/warnings`,
                tools: ['Glob', 'Read', 'Grep'],
                prompt: [
                    `Goal: Find the most recent file matching logs/*.log, read the last ${n} lines.`,
                    `Extract: new failures, test errors, warnings, or retries; include last timestamp.`,
                    `Output a concise status/risk summary only.`
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
                    `Keep it one short sentence.`
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

        let resolveCompletion: (v: boolean) => void;
        const completion = new Promise<boolean>(res => { resolveCompletion = res; });

        void run().then(() => { try { resolveCompletion(true); } catch {} });

        return {
            cancel: () => { try { controller.abort(); } finally { try { resolveCompletion(true); } catch {} } },
            sessionId,
            completion,
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
            const match = line.match(/^\x5BEVENT:(info|warning|error)\x5D\s*(.+)$/i);
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

export async function createAgent() {
    return new LogMonitor(DEFAULT_LOG_PATH, 100, 30);
}
