import minimist from 'minimist';
import { addLog } from '../logger.js';
import type { DriverName } from '../drivers/types.js';

interface CliArgs {
  prompt?: string;
  driver?: DriverName;
  workspace?: string;
}

export const parseCliArgs = (): CliArgs => {
  // Robustly locate the first flag (ignoring script paths like ui.tsx)
  const raw = process.argv.slice(2);
  try { addLog(`[CLI] process.argv: ${JSON.stringify(process.argv)}`); } catch {}
  const firstFlagIdx = raw.findIndex(arg => typeof arg === 'string' && arg.startsWith('-'));
  let toParse = firstFlagIdx >= 0 ? raw.slice(firstFlagIdx) : [];
  // Drop leading "--" separators so minimist will actually parse flags
  while (toParse.length > 0 && toParse[0] === '--') {
    toParse = toParse.slice(1);
  }
  const argv = minimist(toParse);
  const rawPrompt = argv.p ?? argv.prompt;
  const rawDriver = argv.d ?? argv.driver;
  
  const coercePrompt = () => {
    if (typeof rawPrompt === 'string') return rawPrompt;
    if (typeof rawPrompt === 'number') return String(rawPrompt);
    if (Array.isArray(rawPrompt) && rawPrompt.length > 0) {
      return rawPrompt.map(value => (value == null ? '' : String(value))).join(' ');
    }
    return undefined;
  };
  
  const coerceDriver = (): DriverName | undefined => {
    const validDrivers: DriverName[] = ['chat', 'agent', 'manual', 'plan-review-do'];
    if (typeof rawDriver === 'string') {
      const normalized = rawDriver.toLowerCase();
      if (validDrivers.includes(normalized as DriverName)) {
        return normalized as DriverName;
      }
    }
    return undefined;
  };

  const coerceWorkspace = (): string | undefined => {
    if (typeof argv.workspace === 'string' && argv.workspace.trim().length > 0) {
      return argv.workspace.trim();
    }
    if (Array.isArray(argv.workspace) && argv.workspace.length > 0) {
      const first = argv.workspace.find((value: unknown) => typeof value === 'string' && value.trim().length > 0);
      return typeof first === 'string' ? first.trim() : undefined;
    }
    if (typeof argv.w === 'string' && argv.w.trim().length > 0) {
      return argv.w.trim();
    }
    return undefined;
  };
  
  const result = {
    prompt: coercePrompt(),
    driver: coerceDriver(),
    workspace: coerceWorkspace(),
  } as CliArgs;

  try {
    addLog(
      `[CLI] Parsed args -> driver: ${result.driver ?? 'undefined'}, prompt: ${result.prompt ?? 'undefined'}, workspace: ${result.workspace ?? 'undefined'}`
    );
  } catch {}

  return result;
};
