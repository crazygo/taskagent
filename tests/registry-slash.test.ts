import { describe, it, expect, vi } from 'vitest';
import { getDriverBySlash } from '../packages/cli/drivers/registry.js';
import { Driver } from '../packages/cli/drivers/types.js';

describe('slash command registry wiring', () => {
  it('resolves fg:glossary and invokes runAgentPipeline', async () => {
    const entry = getDriverBySlash('fg:glossary');
    expect(entry).toBeTruthy();
    expect(entry!.type).toBe('background_task');
    expect(entry!.id).toBe(Driver.GLOSSARY);

    // Prepare minimal context and message
    const runAgentPipeline = vi.fn().mockResolvedValue(true);

    const context: any = {
      nextMessageId: () => 1,
      messageStore: { appendMessage: vi.fn() },
      finalizeMessageById: (_id: number) => {},
      canUseTool: async () => undefined,
      sourceTabId: 'Glossary',
      workspacePath: process.cwd(),
      session: { id: 'sess-test', initialized: true },
      runAgentPipeline,
    };

    const message = { id: 1, role: 'user', content: 'define API gateway' } as any;
    const handled = await entry!.handler(message, context);
    expect(handled).toBe(true);
    expect(runAgentPipeline).toHaveBeenCalledTimes(1);
    expect(runAgentPipeline).toHaveBeenCalledWith('glossary', 'define API gateway', {
      tabId: 'Glossary',
      session: context.session,
    });
  });

  it('resolves bg:glossary and schedules runAgentPipeline', async () => {
    const entry = getDriverBySlash('bg:glossary');
    expect(entry).toBeTruthy();
    expect(entry!.type).toBe('background_task');
    expect(entry!.id).toBe(Driver.GLOSSARY);

    const scheduleAgentPipeline = vi.fn();

    const context: any = {
      nextMessageId: () => 1,
      messageStore: { appendMessage: vi.fn() },
      finalizeMessageById: (_id: number) => {},
      canUseTool: async () => undefined,
      sourceTabId: 'Glossary',
      workspacePath: process.cwd(),
      session: { id: 'sess-test', initialized: true },
      scheduleAgentPipeline,
    };

    const message = { id: 1, role: 'user', content: 'index terms in background' } as any;
    const handled = await entry!.handler(message, context);
    expect(handled).toBe(true);
    expect(scheduleAgentPipeline).toHaveBeenCalledTimes(1);
    expect(scheduleAgentPipeline).toHaveBeenCalledWith('glossary', 'index terms in background', {
      tabId: 'Glossary',
      session: context.session,
    });
  });
});
