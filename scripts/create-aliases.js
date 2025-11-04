#!/usr/bin/env node
/**
 * Create entry point aliases for different presets
 * 
 * This script creates wrapper scripts that launch TaskAgent with specific presets.
 * For example, taskagent-monitor launches with --preset monitor.
 * 
 * Run this after build:
 * ```bash
 * yarn build
 * node scripts/create-aliases.js
 * ```
 */

import { writeFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Monitor preset wrapper
const monitorWrapper = `#!/usr/bin/env node
// Auto-generated wrapper for Monitor preset
// Launches TaskAgent with --preset monitor

// Add preset argument
process.argv.push('--preset', 'monitor');

// Load main CLI
import('../dist/packages/cli/main.js');
`;

// Output paths
const distDir = join(__dirname, '..', 'dist');
const monitorPath = join(distDir, 'main-monitor.js');

console.log('Creating alias scripts...');

// Write monitor wrapper
writeFileSync(monitorPath, monitorWrapper, 'utf8');
chmodSync(monitorPath, '755');
console.log(`✅ Created ${monitorPath}`);

console.log('✅ Alias scripts created successfully!');
console.log('');
console.log('You can now use:');
console.log('  - taskagent         # Default preset (all features)');
console.log('  - taskagent-monitor # Monitor preset (focused monitoring)');

