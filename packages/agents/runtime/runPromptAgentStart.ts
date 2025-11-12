import crypto from 'crypto';
import { inspect } from 'util';
import { addLog } from '@taskagent/shared/logger';
import { runClaudeStream } from './runClaudeStream.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDefinition, McpServerConfig, tool as createSdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentStartContext, AgentStartSinks, ExecutionHandle } from '../types.js';

type McpTool = ReturnType<typeof createSdkTool>;

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
    getMcpTools?: (ctx: { sourceTabId: string; workspacePath?: string; session: { id: string; initialized: boolean }; rawContext: AgentStartContext }) => Record<string, McpTool> | undefined;
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

    const mcpTools = adapter.getMcpTools?.({
      sourceTabId: context.sourceTabId,
      workspacePath: context.workspacePath,
      session,
      rawContext: context,
    });
    const mcpServers = convertToolsToServers(mcpTools);
    if (mcpServers) {
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
            } else {
              // sinks.onEvent?.(evt as any);
              addLog(`[RunPromptAgentStart] onNonAssistantEvent: no dispatch router for event this message: ${inspect(evt, { depth: 2 })}`);
            }
          } catch (err) {
            addLog(`[RunPromptAgentStart] onNonAssistantEvent error: ${err}, ${inspect(evt, { depth: 3 })}`);
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

function convertToolsToServers(tools?: Record<string, McpTool>): Record<string, McpServerConfig> | undefined {
  if (!tools) {
    return undefined;
  }

  const entries = Object.entries(tools);
  if (entries.length === 0) {
    return undefined;
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const [name, toolDefinition] of entries) {
    if (!toolDefinition) {
      continue;
    }
    const server = createSdkMcpServer({
      name,
      tools: [toolDefinition],
    });
    servers[name] = server as McpServerConfig;
  }

  return Object.keys(servers).length ? servers : undefined;
}
