import { loadEnv } from '../env.ts';
import { parseCliArgs } from './args.ts';

export interface CliConfig {
  prompt?: string;
  // Add other config properties here as needed
}

export const loadCliConfig = (): CliConfig => {
  loadEnv(); // Load environment variables and perform checks
  const cliArgs = parseCliArgs(); // Parse CLI arguments

  return {
    prompt: cliArgs.prompt,
  };
};
