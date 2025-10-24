import minimist from 'minimist';
import { addLog } from '../logger.ts';

export type DriverName = 'manual' | 'plan-review-do' | 'l2+' | 'custom';

interface CliArgs {
  prompt?: string;
  driver?: DriverName;
  // Add other flags/arguments here as needed
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
    const validDrivers: DriverName[] = ['manual', 'plan-review-do', 'l2+', 'custom'];
    if (typeof rawDriver === 'string' && validDrivers.includes(rawDriver as DriverName)) {
      return rawDriver as DriverName;
    }
    return undefined;
  };
  
  const result = {
    prompt: coercePrompt(),
    driver: coerceDriver(),
  } as CliArgs;

  try {
    addLog(`[CLI] Parsed args -> driver: ${result.driver ?? 'undefined'}, prompt: ${result.prompt ?? 'undefined'}`);
  } catch {}

  return result;
};
