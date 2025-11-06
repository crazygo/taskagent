import { getDriverManifest } from '../drivers/registry.js';

const pad = (label: string, width: number) => label.padEnd(width, ' ');

export const printCliUsage = (): void => {
  console.log('Usage: yarn start -- [options]');
  console.log('');
  console.log('Options:');
  console.log(`  ${pad('-h, --help', 18)}Show this message and exit`);
  console.log(`  ${pad('-p, --prompt <text>', 18)}Submit a prompt right after launch`);
  console.log(`  ${pad('-d, --driver <name>', 18)}Select an app tab/driver explicitly`);
  console.log(`  ${pad('--<driver>', 18)}Shortcut for --driver <driver> (e.g. --story)`);
  console.log(`  ${pad('--workspace <path>', 18)}Override the workspace directory`);
  console.log(`  ${pad('-w <path>', 18)}Alias for --workspace`);
  console.log(`  ${pad('--newsession', 18)}Force creation of a fresh Claude session`);
  console.log(`  ${pad('--auto-allow', 18)}Automatically approve agent tool permissions`);
  console.log('');
  console.log('Available drivers:');
  const DRIVER_MANIFEST = getDriverManifest();
  for (const entry of DRIVER_MANIFEST) {
    if (entry.type === 'background_task') {
      console.log(`  ${pad(entry.slash, 18)}${entry.description}`);
    }
  }
  console.log('');
  console.log('Examples:');
  console.log('  yarn start -- --story --newsession -p "Draft the onboarding story"');
  console.log('  yarn start -- -d agent -p "Summarize the latest tasks"');
};
