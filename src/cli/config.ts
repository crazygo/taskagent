import { join } from 'node:path';
import { loadEnv } from '../env.ts';
import { parseCliArgs } from './args.ts';
import { printCliUsage } from './help.ts';
import { addLog } from '../logger.ts';
import type { DriverName } from '../drivers/types.ts';

export interface CliConfig {
  prompt?: string;
  driver?: DriverName;
  workspacePath: string;
  newSession: boolean;
}

export const loadCliConfig = (): CliConfig => {
  const cliArgs = parseCliArgs(); // Parse CLI arguments

  if (cliArgs.help) {
    printCliUsage();
    process.exit(0);
  }

  let workspacePath = cliArgs.workspace;

  if (!workspacePath || workspacePath.trim().length === 0) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      workspacePath = join(home, '.askman', 'default_workspace');
    } else {
      workspacePath = process.cwd();
    }
  }

  workspacePath = workspacePath.trim();

  loadEnv(workspacePath); // Load environment variables using resolved workspace path

  const newSession = cliArgs.newSession === true;

  const cfg: CliConfig = {
    prompt: cliArgs.prompt,
    driver: cliArgs.driver,
    workspacePath,
    newSession,
  };

  try {
    addLog(
      `[CLI] Config -> driver: ${cfg.driver ?? 'undefined'}, prompt: ${cfg.prompt ?? 'undefined'}, workspace: ${cfg.workspacePath ?? 'undefined'}, newSession: ${cfg.newSession}`
    );
  } catch {}

  return cfg;
};
