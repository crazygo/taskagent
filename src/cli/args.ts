import minimist from 'minimist';

interface CliArgs {
  prompt?: string;
  // Add other flags/arguments here as needed
}

export const parseCliArgs = (): CliArgs => {
  const argv = minimist(process.argv.slice(2));
  const rawPrompt = argv.p ?? argv.prompt;
  return {
    prompt: typeof rawPrompt === 'string' ? rawPrompt : undefined,
  };
};