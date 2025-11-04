import { join } from 'node:path';
import { loadEnv } from '@taskagent/shared/env';
import { parseCliArgs } from './args.js';
import { printCliUsage } from './help.js';
import { addLog } from '@taskagent/shared/logger';
import type { DriverName } from '../drivers/types.js';

export interface CliConfig {
  prompt?: string;
  driver?: DriverName;
  workspacePath: string;
  newSession: boolean;
  ignoredPositionalPrompt?: string;
  preset?: string; // Preset name: 'default', 'monitor', etc.
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
    ignoredPositionalPrompt: cliArgs.ignoredPositionalPrompt,
    preset: cliArgs.preset,
  };

  try {
    addLog(
      `[CLI] Config -> driver: ${cfg.driver ?? 'undefined'}, prompt: ${cfg.prompt ?? 'undefined'}, ignoredPositionalPrompt: ${cfg.ignoredPositionalPrompt ?? 'undefined'}, workspace: ${cfg.workspacePath ?? 'undefined'}, newSession: ${cfg.newSession}, preset: ${cfg.preset ?? 'undefined'}`
    );
  } catch {}

  return cfg;
};
