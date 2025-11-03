import { join } from 'node:path';
import { loadEnv } from '../env.js';
import { parseCliArgs } from './args.js';
import { printCliUsage } from './help.js';
import { addLog } from '../logger.js';
import type { DriverName } from '../drivers/types.js';

export interface CliConfig {
  prompt?: string;
  driver?: DriverName;
  workspacePath: string;
  newSession: boolean;
  ignoredPositionalPrompt?: string; // New field
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
    ignoredPositionalPrompt: cliArgs.ignoredPositionalPrompt, // Pass through new field
  };

  try {
    addLog(
      `[CLI] Config -> driver: ${cfg.driver ?? 'undefined'}, prompt: ${cfg.prompt ?? 'undefined'}, ignoredPositionalPrompt: ${cfg.ignoredPositionalPrompt ?? 'undefined'}, workspace: ${cfg.workspacePath ?? 'undefined'}, newSession: ${cfg.newSession}`
    );
  } catch {}

  return cfg;
};
