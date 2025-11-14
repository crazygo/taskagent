#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const artifact = `/tmp/taskagent-${version}.${Date.now()}.tgz`;

const run = (cmd, opts = {}) => execSync(cmd, {
  stdio: 'inherit',
  cwd: opts.cwd ?? repoRoot,
  env: { ...process.env, ...opts.env },
});

run('yarn build');
run(`yarn pack --filename ${artifact}`);

// Extract and verify the packed tarball (what users will get)
const testDir = `/tmp/taskagent-test-${Date.now()}`;
run(`mkdir -p ${testDir}`);
run(`tar -xzf ${artifact} -C ${testDir}`);

// Create clean npm environment without PnP interference
const cleanEnv = {
  ...process.env,
  NODE_ENV: 'production',
  // Remove PnP variables to prevent interference
  NODE_OPTIONS: undefined,
  YARN_IGNORE_PATH: '1',
};
delete cleanEnv.npm_config_user_agent;

// Install dependencies for the extracted package
run(`npm install --ignore-scripts`, {
  cwd: `${testDir}/package`,
  env: cleanEnv,
});

// Run the extracted package binary (what users will actually run)
run(`node dist/cli/main.js --workspace /tmp --start -p 'list files' --auto-exit`, {
  cwd: `${testDir}/package`,
  env: cleanEnv,
});

run(`rm -rf ${testDir}`);

writeFileSync('/tmp/taskagent-last-pack.txt', artifact);
console.log(`\n✅ pack smoke test passed (extracted package) -> ${artifact}`);
