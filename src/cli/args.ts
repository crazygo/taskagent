import minimist from 'minimist';
import { addLog } from '../logger.js';
import type { DriverName } from '../drivers/types.js';

interface CliArgs {
  prompt?: string;
  driver?: DriverName;
  workspace?: string;
  newSession?: boolean;
  help?: boolean;
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

  const validDrivers: DriverName[] = [
    'chat',
    'agent',
    'manual',
    'plan-review-do',
    'glossary',
    'story',
    'ui-review',
    'logic-review',
    'data-review',
  ];

  const detectDriverFlag = (): DriverName | undefined => {
    for (const candidate of validDrivers) {
      if (argv[candidate] === true) {
        return candidate;
      }
      const value = argv[candidate];
      if (typeof value === 'string' && value.trim().length > 0) {
        const normalized = value.trim().toLowerCase();
        if (normalized === candidate) {
          return candidate;
        }
      }
    }
    return undefined;
  };

  const rawDriverInput = argv.d ?? argv.driver;
  const rawDriver = rawDriverInput ?? detectDriverFlag();

  const coerceBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'n'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  };

  const rawNewSession = coerceBoolean(argv.newsession ?? argv['new-session']);
  const rawHelp = coerceBoolean(argv.help ?? argv.h);
  
  const coercePrompt = () => {
    if (typeof rawPrompt === 'string') return rawPrompt;
    if (typeof rawPrompt === 'number') return String(rawPrompt);
    if (Array.isArray(rawPrompt) && rawPrompt.length > 0) {
      return rawPrompt.map(value => (value == null ? '' : String(value))).join(' ');
    }
    return undefined;
  };

  const coerceDriver = (): DriverName | undefined => {
    if (typeof rawDriver === 'string') {
      const normalized = rawDriver.toLowerCase();
      if (validDrivers.includes(normalized as DriverName)) {
        return normalized as DriverName;
      }
    }
    if (typeof rawDriver === 'boolean' && rawDriver) {
      // When minimist produces a boolean (e.g. `--story`), detectDriverFlag has already resolved it.
      addLog('[CLI] Warning: --driver flag was passed (e.g. --story), but no driver was detected. This may indicate a bug in driver detection logic.');
      return undefined;
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
  
  const result: CliArgs = {
    prompt: coercePrompt(),
    driver: coerceDriver(),
    workspace: coerceWorkspace(),
    newSession: rawNewSession,
    help: rawHelp,
  };

  try {
    addLog(
      `[CLI] Parsed args -> driver: ${result.driver ?? 'undefined'}, prompt: ${result.prompt ?? 'undefined'}, workspace: ${result.workspace ?? 'undefined'}, newSession: ${result.newSession ?? 'undefined'}, help: ${result.help ?? 'undefined'}`
    );
  } catch {}

  return result;
};
