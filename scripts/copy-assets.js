import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const sourceRoot = join(repoRoot, 'packages');
// With --splitting, tsup outputs to dist/packages/, so .agent.md should go to dist/packages/ too
const targetRoot = join(repoRoot, 'dist/packages');
const EXT = '.agent.md';

function copyAgents(fromDir) {
  for (const entry of readdirSync(fromDir)) {
    const absPath = join(fromDir, entry);
    const stats = statSync(absPath);
    if (stats.isDirectory()) {
      copyAgents(absPath);
      continue;
    }
    if (!absPath.endsWith(EXT)) continue;
    const relPath = relative(sourceRoot, absPath);
    const destPath = join(targetRoot, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(absPath, destPath);
    console.log(`Copied ${relPath}`);
  }
}

copyAgents(sourceRoot);
