import { describe, it, expect, vi } from 'vitest';
import { getDriverBySlash } from '../src/drivers/registry.js';
import { Driver } from '../src/drivers/types.js';
import { EventEmitter } from 'node:events';

describe('slash command registry wiring', () => {
  it('resolves fg:glossary and invokes startForeground', async () => {
    const entry = getDriverBySlash('fg:glossary');
    expect(entry).toBeTruthy();
    expect(entry!.type).toBe('background_task');
    expect(entry!.id).toBe(Driver.GLOSSARY);

    // Prepare minimal context and message
    const active: any[] = [];
    const frozen: any[] = [];
    let msgId = 1;
    const startForeground = vi.fn().mockReturnValue({ cancel: () => {}, sessionId: 'test-session' });

    const context: any = {
      nextMessageId: () => msgId++,
      setActiveMessages: (updater: any) => { active.splice(0, active.length, ...updater(active)); },
      setFrozenMessages: (updater: any) => { frozen.splice(0, frozen.length, ...updater(frozen)); },
      finalizeMessageById: (_id: number) => {},
      canUseTool: async () => undefined,
      sourceTabId: 'Glossary',
      workspacePath: process.cwd(),
      session: { id: 'sess-test', initialized: true },
      startForeground,
    };

    const message = { id: 1, role: 'user', content: 'define API gateway' } as any;
    const handled = await entry!.handler(message, context);
    expect(handled).toBe(true);
    expect(startForeground).toHaveBeenCalledTimes(1);
    // Should have queued user + pending assistant
    expect(active.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves bg:glossary and passes forkSession=true to startBackground', async () => {
    const entry = getDriverBySlash('bg:glossary');
    expect(entry).toBeTruthy();
    expect(entry!.type).toBe('background_task');
    expect(entry!.id).toBe(Driver.GLOSSARY);

    const frozen: any[] = [];
    let msgId = 1;
    const emitter = new EventEmitter();
    const startBackground = vi.fn().mockReturnValue({ task: { id: 'task-1' }, emitter });

    const context: any = {
      nextMessageId: () => msgId++,
      setActiveMessages: (_: any) => {},
      setFrozenMessages: (updater: any) => { frozen.splice(0, frozen.length, ...updater(frozen)); },
      finalizeMessageById: (_id: number) => {},
      canUseTool: async () => undefined,
      sourceTabId: 'Glossary',
      workspacePath: process.cwd(),
      session: { id: 'sess-test', initialized: true },
      startBackground,
    };

    const message = { id: 1, role: 'user', content: 'index terms in background' } as any;
    const handled = await entry!.handler(message, context);
    expect(handled).toBe(true);
    expect(startBackground).toHaveBeenCalledTimes(1);
    const [_agent, _prompt, options] = startBackground.mock.calls[0];
    expect(options.forkSession).toBe(true);
  });
});
