import minimist from 'minimist';

interface CliArgs {
  prompt?: string;
  // Add other flags/arguments here as needed
}

export const parseCliArgs = (): CliArgs => {
  const argv = minimist(process.argv.slice(2));
  const rawPrompt = argv.p ?? argv.prompt;
  const coercePrompt = () => {
    if (typeof rawPrompt === 'string') return rawPrompt;
    if (typeof rawPrompt === 'number') return String(rawPrompt);
    if (Array.isArray(rawPrompt) && rawPrompt.length > 0) {
      return rawPrompt.map(value => (value == null ? '' : String(value))).join(' ');
    }
    return undefined;
  };
  return {
    prompt: coercePrompt(),
  };
};
