import crypto from 'crypto';
import { inspect } from 'util';
import { addLog } from '@taskagent/shared/logger';
import { runClaudeStream } from './runClaudeStream.js';
import type { AgentDefinition, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
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
    getMcpServers?: (ctx: { sourceTabId: string; workspacePath?: string; session: { id: string; initialized: boolean }; rawContext: AgentStartContext }) => Record<string, McpServerConfig> | undefined;
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

    const mcpServers = adapter.getMcpServers?.({
      sourceTabId: context.sourceTabId,
      workspacePath: context.workspacePath,
      session,
      rawContext: context,
    });
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      (options as any).mcpServers = mcpServers;
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

    const completion = runClaudeStream({
      prompt,
      session,
      queryOptions: options as any,
      callbacks: {
        onTextDelta: (chunk: string) => {
          fullText += chunk;
          addLog(`[RunPromptAgentStart] onTextDelta called, chunk.length=${chunk.length}, fullText.length=${fullText.length}`);
          try { sinks.onText(chunk); } catch {}
          if (adapter.parseOutput && sinks.onEvent) {
            try {
              const events = adapter.parseOutput(chunk) || [];
              for (const e of events) sinks.onEvent(e);
            } catch {}
          }
        },
        onReasoningDelta: sinks.onReasoning,
            onSessionId: (sid: string) => { try { sinks.onSessionId?.(sid); } catch {} },
        onToolUse: (event) => {
          // Forward tool use events to UI as info events
          if (sinks.onEvent) {
            try {
              sinks.onEvent(event);
            } catch {}
          }
        },
        onToolResult: (event) => {
          // Forward tool result events to UI as info events
          if (sinks.onEvent) {
            try {
              sinks.onEvent(event);
            } catch {}
          }
        },
        onNonAssistantEvent: (evt: unknown) => {
          addLog(`[RunPromptAgentStart] onNonAssistantEvent called, uuid=${(evt as any)?.uuid ? (evt as any).uuid : 'n/a'}`);
          try {
            const evtObj = evt as any;
            if (evtObj && typeof evtObj === 'object' && evtObj.type === 'result') {
              const cost = evtObj.total_cost_usd;
              const dur = evtObj.duration_ms;
              const turns = evtObj.num_turns;
              addLog(`[RunPromptAgentStart] RESULT EVENT CAPTURED: cost=${cost}, duration=${dur}ms, turns=${turns}`);
              // Block forwarding and inject special marker to prove this path displays text
              sinks.onEvent?.({
                level: 'debug',
                message: `duration=${dur}ms, turns=${turns}, cost=$${cost}`,
                ts: Date.now(),
              });
              return; // Don't forward the original result event
            }
            sinks.onEvent?.(evt as any);
          } catch (err) {
            addLog(`[RunPromptAgentStart] onNonAssistantEvent error: ${err}`);
          }
        },
      },
      log: addLog,
    }).then(() => {
      addLog(`[RunPromptAgentStart] Stream completed, calling onCompleted with fullText.length=${fullText.length}`);
      try { sinks.onCompleted?.(fullText); } catch {}
      return true;
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      try {
        addLog(`[RunnableAgent] Stream failure detail: ${inspect(err, { depth: 3 })}`);
      } catch {}
      if (err instanceof Error && err.stack) {
        addLog(`[RunnableAgent] Stream failed stack: ${err.stack}`);
      }
      addLog(`[RunnableAgent] Stream failed: ${message}`);
      try { sinks.onFailed?.(message); } catch {}
      return false;
    });

    return {
      cancel: () => controller.abort(),
      sessionId: session.id,
      completion,
    };
  };
}
