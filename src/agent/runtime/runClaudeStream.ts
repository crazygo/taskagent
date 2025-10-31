import { inspect } from 'util';
import { query, type SDKAssistantMessage, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import { addLog } from '../../logger.js';

const truncate = (s: string, n = 200) => (s.length <= n ? s : `${s.slice(0, n)}…`);

export type ToolUseEvent = {
    id: string;
    name: string;
    input?: unknown;
    description?: string;
};

export type ToolResultEvent = {
    id: string;
    name: string;
    durationMs?: number;
    payload: unknown;
};

export type RunClaudeStreamCallbacks = {
    onTextDelta?: (text: string) => void;
    onReasoningDelta?: (text: string) => void;
    onToolUse?: (event: ToolUseEvent) => void;
    onToolResult?: (event: ToolResultEvent) => void;
    onNonAssistantEvent?: (event: unknown) => void;
};

export type RunClaudeStreamParams = {
    prompt: string;
    session: {
        id: string;
        initialized: boolean;
    };
    queryOptions: {
        model: string | undefined;
        cwd?: string;
        canUseTool: (toolName: string, input: Record<string, unknown>, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<unknown>;
        agents?: Record<string, unknown>;
        systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
        allowedTools?: string[];
        disallowedTools?: string[];
        permissionMode?: string;
    };
    log?: (message: string) => void;
    callbacks?: RunClaudeStreamCallbacks;
};

export type RunClaudeStreamResult = {
    assistantChars: number;
    reasoningChars: number;
    eventCount: number;
    firstEventMillis?: number;
    firstAssistantMillis?: number;
    totalDurationMillis: number;
};

export const runClaudeStream = async ({
    prompt,
    session,
    queryOptions,
    log: logFn,
    callbacks,
}: RunClaudeStreamParams): Promise<RunClaudeStreamResult> => {
    const log = logFn ?? addLog;
    const cb = callbacks ?? {};

    const options: Record<string, unknown> = {
        model: queryOptions.model,
        cwd: queryOptions.cwd,
        canUseTool: queryOptions.canUseTool,
    };

    if (session.initialized) {
        options.resume = session.id;
    } else {
        options.extraArgs = { 'session-id': session.id };
    }

    if (queryOptions.agents) {
        (options as Record<string, unknown>).agents = queryOptions.agents;
    }

    if (queryOptions.systemPrompt) {
        (options as Record<string, unknown>).systemPrompt = queryOptions.systemPrompt;
    }
    if (queryOptions.allowedTools) {
        (options as Record<string, unknown>).allowedTools = queryOptions.allowedTools;
    }
    if (queryOptions.disallowedTools) {
        (options as Record<string, unknown>).disallowedTools = queryOptions.disallowedTools;
    }
    if (queryOptions.permissionMode) {
        (options as Record<string, unknown>).permissionMode = queryOptions.permissionMode;
    }

    const result = query({
        prompt,
        options,
    });

    log('[Agent] Stream opened; awaiting events...');

    const streamStartAt = Date.now();
    let firstEventAt: number | null = null;
    let firstAssistantAt: number | null = null;
    let eventCount = 0;
    let assistantChars = 0;
    let reasoningChars = 0;

    const toolUseStartAt = new Map<string, number>();
    const toolUseName = new Map<string, string>();

    for await (const message of result) {
        try {
            const type = (message as { type?: string } | null)?.type ?? 'unknown';
            eventCount += 1;
            if (firstEventAt === null) {
                firstEventAt = Date.now();
            }
            const sinceStartMs = Date.now() - streamStartAt;
            const sinceStartSeconds = (sinceStartMs / 1000).toFixed(3);
            log(`[Agent] Event #${eventCount} type=${type} (+${sinceStartSeconds}s)`);
        } catch (error) {
            log(`[Agent] Failed to log event metadata: ${String(error)}`);
        }

        if ((message as { type?: string }).type === 'assistant') {
            const assistantMessage = message as SDKAssistantMessage;
            try {
                const blocksLen = Array.isArray((assistantMessage as { message?: { content?: unknown[] } }).message?.content)
                    ? (assistantMessage as { message: { content: unknown[] } }).message.content.length
                    : 0;
                log(`[Agent] Assistant blocks=${blocksLen}`);
            } catch (error) {
                log(`[Agent] Failed to log assistant block metadata: ${String(error)}`);
            }

            if (firstAssistantAt === null) {
                firstAssistantAt = Date.now();
            }

            for (const block of assistantMessage.message.content) {
                if (block.type === 'text' && typeof block.text === 'string') {
                    if (block.text) {
                        assistantChars += block.text.length;
                        cb.onTextDelta?.(block.text);
                        log(`[Agent] ▲ text delta len=${block.text.length}: ${JSON.stringify(block.text)}`);
                    }
                } else if (block.type === 'reasoning' && typeof block.text === 'string') {
                    if (block.text) {
                        reasoningChars += block.text.length;
                        cb.onReasoningDelta?.(block.text);
                        log(`[Agent] ▲ reasoning delta len=${block.text.length}: ${JSON.stringify(block.text)}`);
                    }
                } else if ((block as any)?.type === 'tool_use') {
                    const raw = block as any;
                    const id = String(raw?.id ?? raw?.tool_use_id ?? 'unknown');
                    const name = String(raw?.name ?? raw?.tool?.name ?? 'unknown');
                    const input = raw?.input ?? raw?.arguments ?? raw?.params;
                    toolUseStartAt.set(id, Date.now());
                    toolUseName.set(id, name);
                    log(`[ToolUse] start id=${id} name=${name}`);
                    try {
                        log(`[ToolUse] input full id=${id}: ${JSON.stringify(input)}`);
                    } catch {
                        log(`[ToolUse] input inspect id=${id}: ${inspect(input, { depth: 6 })}`);
                    }
                    const description = (input && typeof (input as { description?: unknown }).description === 'string')
                        ? String((input as { description?: string }).description)
                        : undefined;
                    cb.onToolUse?.({ id, name, input, description });
                }
            }
        } else {
            cb.onNonAssistantEvent?.(message);
            try {
                const m: any = message;
                const kind = m?.type ?? 'unknown';
                const name = m?.tool?.name ?? m?.name ?? m?.tool_name ?? m?.event ?? 'unknown';
                const action = m?.action ?? m?.status ?? m?.event ?? undefined;
                const inputObj = m?.input ?? m?.arguments ?? m?.params ?? undefined;
                const stdout = m?.stdout;
                const stderr = m?.stderr;
                const parts: string[] = [];
                parts.push(`kind=${String(kind)}`);
                if (name) parts.push(`name=${String(name)}`);
                if (action) parts.push(`action=${String(action)}`);
                if (inputObj !== undefined) {
                    try {
                        parts.push(`input=${truncate(JSON.stringify(inputObj))}`);
                    } catch {
                        parts.push(`input_inspect=${truncate(inspect(inputObj, { depth: 4 }))}`);
                    }
                }
                if (typeof stdout === 'string' && stdout.length > 0) parts.push(`stdout_len=${stdout.length}`);
                if (typeof stderr === 'string' && stderr.length > 0) parts.push(`stderr_len=${stderr.length}`);
                log(`[Agent] Non-assistant: ${parts.join(' | ')}`);
                try {
                    log(`[Agent] Event full (type=${String(kind)}): ${JSON.stringify(m)}`);
                } catch (error) {
                    log(`[Agent] Event full (inspect) type=${String(kind)}: ${inspect(m, { depth: 6 })}`);
                }
            } catch (error) {
                log(`[Agent] Non-assistant event (logging failed): ${String(error)}`);
            }

            try {
                const userMessage: any = message;
                if (userMessage?.type === 'user' && Array.isArray(userMessage?.message?.content)) {
                    for (const block of userMessage.message.content) {
                        if (block?.type === 'tool_result') {
                            const rid = String(block?.tool_use_id ?? 'unknown');
                            const name = toolUseName.get(rid) ?? 'unknown';
                            const started = toolUseStartAt.get(rid);
                            const duration = started ? (Date.now() - started) : undefined;
                            log(`[ToolResult] id=${rid} name=${name} duration_ms=${duration ?? 'n/a'}`);
                            try {
                                log(`[ToolResult] full id=${rid}: ${JSON.stringify(block)}`);
                            } catch {
                                log(`[ToolResult] inspect id=${rid}: ${inspect(block, { depth: 6 })}`);
                            }
                            const out = block?.content ?? block?.result ?? block?.stdout ?? block?.stderr ?? '';
                            if (typeof out === 'string') {
                                log(`[ToolResult] out_len id=${rid} = ${out.length}`);
                            }
                            cb.onToolResult?.({ id: rid, name, durationMs: duration, payload: block });
                            toolUseStartAt.delete(rid);
                            toolUseName.delete(rid);
                        }
                    }
                }
            } catch (error) {
                log(`[Agent] Failed to process tool_result blocks: ${String(error)}`);
            }
        }
    }

    const totalDurationMillis = Date.now() - streamStartAt;
    const totalSeconds = (totalDurationMillis / 1000).toFixed(2);
    const firstEvtSec = firstEventAt ? ((firstEventAt - streamStartAt) / 1000).toFixed(2) : 'n/a';
    const firstAsstSec = firstAssistantAt ? ((firstAssistantAt - streamStartAt) / 1000).toFixed(2) : 'n/a';

    log(`[Agent] Stream summary: events=${eventCount}, assistant_chars=${assistantChars}, reasoning_chars=${reasoningChars}, t=${totalSeconds}s, t_first_evt=${firstEvtSec}s, t_first_asst=${firstAsstSec}s`);
    log(`[Agent] Tool pairing summary: pending_starts=${toolUseStartAt.size}`);
    log('[Agent] Response completed.');

    return {
        assistantChars,
        reasoningChars,
        eventCount,
        firstEventMillis: firstEventAt ? firstEventAt - streamStartAt : undefined,
        firstAssistantMillis: firstAssistantAt ? firstAssistantAt - streamStartAt : undefined,
        totalDurationMillis,
    };
};
