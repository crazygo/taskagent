import minimist from 'minimist';

import { addLog } from '@taskagent/shared/logger';
import { DRIVER_NAMES, type DriverName } from '../drivers/types.js';

interface CliArgs {
  prompt?: string;
  driver?: DriverName;
  workspace?: string;
  newSession?: boolean;
  autoAllow?: boolean;
  autoExit?: boolean; // added
  help?: boolean;
  ignoredPositionalPrompt?: string;
  preset?: string;
}

export const parseCliArgs = (): CliArgs => {
  const raw = process.argv.slice(2);
  try { addLog(`[CLI] process.argv: ${JSON.stringify(process.argv)}`); } catch {}
  const firstFlagIdx = raw.findIndex(arg => typeof arg === 'string' && arg.startsWith('-'));
  let toParse = firstFlagIdx >= 0 ? raw.slice(firstFlagIdx) : [];
  while (toParse.length > 0 && toParse[0] === '--') {
    toParse = toParse.slice(1);
  }
  const argv = minimist(toParse);
  const rawPrompt = argv.p ?? argv.prompt;

  const normalizeDriverSlug = (value: string): DriverName | undefined => {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
    return DRIVER_NAMES.find(candidate => candidate === normalized);
  };

  const detectDriverFlag = (): DriverName | undefined => {
    for (const candidate of DRIVER_NAMES) {
      if (argv[candidate] === true) {
        return candidate;
      }
      const value = argv[candidate];
      if (typeof value === 'string' && value.trim().length > 0) {
        const normalizedValue = normalizeDriverSlug(value);
        if (normalizedValue === candidate) return candidate;
      }
    }
    return undefined;
  };

  const rawDriverInput = argv.d ?? argv.driver;
  const detectedDriver = rawDriverInput ?? detectDriverFlag(); // Use a new variable for detected driver

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
  const rawAutoAllow = coerceBoolean(argv['auto-allow'] ?? argv.autoallow ?? argv.autoAllow);
  const rawAutoExit = coerceBoolean(argv['auto-exit'] ?? argv.autoexit ?? argv.autoExit); // parse --auto-exit flag
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
    if (typeof detectedDriver === 'string') {
      return normalizeDriverSlug(detectedDriver);
    }
    if (detectedDriver === true) {
      // This case should ideally be handled by detectDriverFlag, but as a fallback
      addLog('[CLI] Warning: --driver flag was passed (e.g. --build-specs), but no driver was detected. This may indicate a bug in driver detection logic.');
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
  
  let ignoredPositionalPrompt: string | undefined;
  // Detect if a driver was specified, but no -p/--prompt, and there's a single positional arg
  if (detectedDriver && !rawPrompt && argv._ && argv._.length === 1 && typeof argv._[0] === 'string') {
    ignoredPositionalPrompt = argv._[0];
  }

  const coercePreset = (): string | undefined => {
    const rawPreset = argv.preset;
    if (typeof rawPreset === 'string' && rawPreset.trim().length > 0) {
      return rawPreset.trim().toLowerCase();
    }
    return undefined;
  };

  const result: CliArgs = {
    prompt: coercePrompt(),
    driver: coerceDriver(),
    workspace: coerceWorkspace(),
    newSession: rawNewSession,
    autoAllow: rawAutoAllow,
    autoExit: rawAutoExit,
    help: rawHelp,
    ignoredPositionalPrompt,
    preset: coercePreset(),
  };

  try {
    addLog(
      `[CLI] Parsed args -> driver: ${result.driver ?? 'undefined'}, prompt: ${result.prompt ?? 'undefined'}, ignoredPositionalPrompt: ${result.ignoredPositionalPrompt ?? 'undefined'}, workspace: ${result.workspace ?? 'undefined'}, newSession: ${result.newSession ?? 'undefined'}, autoAllow: ${result.autoAllow ?? 'undefined'}, autoExit: ${result.autoExit ?? 'undefined'}, help: ${result.help ?? 'undefined'}, preset: ${result.preset ?? 'undefined'}`
    );
  } catch {}

  return result;
};
