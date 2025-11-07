import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runClaudeStream } from '../packages/agents/runtime/runClaudeStream.js';

// Mock the Anthropic Claude Agent SDK's query function to capture options
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  let lastArgs: any = null;
  async function* emptyStream() {}
  return {
    query: (args: any) => { lastArgs = args; return emptyStream(); },
    __getLastArgs: () => lastArgs,
  } as any;
});

describe('forkSession propagation', () => {
  beforeEach(() => {
    // reset captured args if needed
    const mod = require('@anthropic-ai/claude-agent-sdk');
    if (mod.__getLastArgs) mod.__getLastArgs();
  });

  it('passes forkSession=true to SDK options when provided', async () => {
    await runClaudeStream({
      prompt: 'hello',
      session: { id: 'sess-123', initialized: true },
      queryOptions: {
        model: 'fake-model',
        cwd: process.cwd(),
        canUseTool: async (_toolName, input, _options) => ({
          behavior: 'allow',
          updatedInput: input,
        }),
        forkSession: true,
      },
    });

    const { __getLastArgs } = await import('@anthropic-ai/claude-agent-sdk' as any);
    const last = (__getLastArgs as any)();
    expect(last).toBeTruthy();
    expect(last.options).toBeTruthy();
    // Ensure resume path is used
    expect(last.options.resume).toBe('sess-123');
    // Ensure forking flag is present
    expect(last.options.forkSession).toBe(true);
  });
});
