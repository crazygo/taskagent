import crypto from 'crypto';
import { addLog } from '../../logger.js';
import { runClaudeStream } from './runClaudeStream.js';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { AgentStartContext, AgentStartSinks, ExecutionHandle } from '../types.js';

/**
 * Build a default start() implementation for PromptAgent-style objects.
 * The provided adapter must expose getPrompt(userInput, ctx), and may optionally
 * expose getAgentDefinitions(), getModel(), and parseOutput().
 */
export function buildPromptAgentStart(
  adapter: {
    getPrompt: (userInput: string, ctx: { sourceTabId: string; workspacePath?: string }) => string;
    getSystemPrompt?: () => string | { type: 'preset'; preset: 'claude_code'; append?: string };
    getAgentDefinitions?: () => Record<string, AgentDefinition> | undefined;
    getModel?: () => string | undefined;
    parseOutput?: (rawChunk: string) => { level: 'info'|'warning'|'error'; message: string; ts: number }[];
  }
): (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle {
  return (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
    const controller = new AbortController();
    try { addLog(`[RunPromptAgentStart] Context session received: ${JSON.stringify(context.session)}`); } catch {}
    const session = context.session ?? { id: crypto.randomUUID(), initialized: false };

    const prompt = adapter.getPrompt(userInput, {
      sourceTabId: context.sourceTabId,
      workspacePath: context.workspacePath,
    });

    const options: Record<string, unknown> = {
      model: adapter.getModel?.() || process.env.ANTHROPIC_MODEL,
      cwd: context.workspacePath,
      canUseTool: sinks.canUseTool,
      systemPrompt: (adapter.getSystemPrompt?.() ?? { type: 'preset', preset: 'claude_code' }) as any,
    };

    // Request forking when resuming if asked by the caller (background runs)
    if (context.forkSession) {
      (options as any).forkSession = true;
    }

    // Inject sub-agents if present
    try {
      const defs = adapter.getAgentDefinitions?.();
      if (defs && Object.keys(defs).length > 0) {
        (options as any).agents = defs;
        addLog('[RunnableAgent] Injected agent definitions');
      }
    } catch (e) {
      addLog(`[RunnableAgent] getAgentDefinitions failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Accumulator for completion
    let fullText = '';

    void runClaudeStream({
      prompt,
      session,
      queryOptions: options as any,
      callbacks: {
        onTextDelta: (chunk: string) => {
          fullText += chunk;
          try { sinks.onText(chunk); } catch {}
          if (adapter.parseOutput && sinks.onEvent) {
            try {
              const events = adapter.parseOutput(chunk) || [];
              for (const e of events) sinks.onEvent(e);
            } catch {}
          }
        },
        onReasoningDelta: sinks.onReasoning,
      },
      log: addLog,
    }).then(() => {
      try { sinks.onCompleted?.(fullText); } catch {}
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`[RunnableAgent] Stream failed: ${message}`);
      try { sinks.onFailed?.(message); } catch {}
    });

    return {
      cancel: () => controller.abort(),
      sessionId: session.id,
    };
  };
}
