import { loadEnv } from '../env.ts';
import { parseCliArgs, type DriverName } from './args.ts';
import { addLog } from '../logger.ts';

export interface CliConfig {
  prompt?: string;
  driver?: DriverName;
  // Add other config properties here as needed
}

export const loadCliConfig = (): CliConfig => {
  loadEnv(); // Load environment variables and perform checks
  const cliArgs = parseCliArgs(); // Parse CLI arguments

  const cfg: CliConfig = {
    prompt: cliArgs.prompt,
    driver: cliArgs.driver,
  };

  try {
    addLog(`[CLI] Config -> driver: ${cfg.driver ?? 'undefined'}, prompt: ${cfg.prompt ?? 'undefined'}`);
  } catch {}

  return cfg;
};
