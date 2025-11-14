#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const artifact = `/tmp/taskagent-${version}.${Date.now()}.tgz`;

const run = (cmd, opts = {}) => {
  console.log(`$ ${cmd}`);
  return execSync(cmd, {
    stdio: 'inherit',
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
  });
};

run('yarn build');
run(`yarn pack --filename ${artifact}`);

// NPX-only smoke test (tarball)
const cleanEnv = { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: undefined, YARN_IGNORE_PATH: '1' };
delete cleanEnv.npm_config_user_agent;
// derive command name from local package.json (same as tarball)
const derivedCmd = (() => {
  if (typeof pkg.bin === 'string') return String(pkg.name || '').replace(/^@[^\/]+\//, '') || 'task';
  if (pkg.bin && typeof pkg.bin === 'object') {
    const keys = Object.keys(pkg.bin);
    if (keys.length > 0) return keys[0];
  }
  return 'task';
})();
run(`npx -y -p ${artifact} ${derivedCmd} --workspace /tmp --newsession --start -p 'list files' --auto-exit`, { cwd: '/tmp', env: cleanEnv });

writeFileSync('/tmp/taskagent-last-pack.txt', artifact);
console.log(`\n✅ pack smoke test passed (npx tarball) -> ${artifact}`);
