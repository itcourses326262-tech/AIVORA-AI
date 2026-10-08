#!/usr/bin/env node
// Isolated Next.js preview for parallel work: mirrors the working tree into a scratch directory
// (own .next, SQLite file and media dir) and serves it there, re-syncing every second.
// Several previews can run side by side without clobbering each other's .next or tsconfig.json.
//
//   node scripts/preview.mjs <name> <port> [dev|start]
//
// `dev` hot-reloads on every edit made in the real tree; `start` builds once, then serves.
// Provider keys from .env.local are NOT copied unless PREVIEW_WITH_ENV=1 (the demo provider is on).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [name, port, mode = 'dev'] = process.argv.slice(2);
if (!name || !/^\d+$/.test(port ?? '') || !['dev', 'start'].includes(mode)) {
  console.error('usage: node scripts/preview.mjs <name> <port> [dev|start]');
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(process.env.PREVIEW_BASE || path.join(os.tmpdir(), 'aivore-preview'), name);
const dataDir = path.join(dir, '.data');
// Never mirrored, never deleted from the preview.
const SKIP = new Set([
  'node_modules',
  '.next',
  '.git',
  'data',
  '.data',
  'coverage',
  'test-results',
  'playwright-report',
  '.env.local',
]);

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(path.join(dir, 'node_modules'))) {
  // Hardlink copy: instant and free on the same filesystem; plain copy as a fallback.
  const src = path.join(root, 'node_modules');
  const dst = path.join(dir, 'node_modules');
  try {
    execFileSync('cp', ['-al', src, dst], { stdio: 'ignore' });
  } catch {
    execFileSync('cp', ['-a', src, dst], { stdio: 'ignore' });
  }
}

function listFiles(base, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
    if (rel === '' && SKIP.has(entry.name)) continue;
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(base, next));
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

function sync() {
  const files = listFiles(root);
  const keep = new Set(files);
  for (const rel of files) {
    const from = path.join(root, rel);
    const to = path.join(dir, rel);
    const a = fs.statSync(from);
    const b = fs.statSync(to, { throwIfNoEntry: false });
    if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  for (const rel of listFiles(dir)) {
    if (!keep.has(rel)) fs.rmSync(path.join(dir, rel), { force: true });
  }
}

sync();
if (process.env.PREVIEW_WITH_ENV === '1' && fs.existsSync(path.join(root, '.env.local'))) {
  fs.copyFileSync(path.join(root, '.env.local'), path.join(dir, '.env.local'));
}

const env = {
  ...process.env,
  DATABASE_PATH: path.join(dataDir, 'aivore.db'),
  STORAGE_LOCAL_DIR: path.join(dataDir, 'media'),
  WORKER_MODE: process.env.WORKER_MODE || 'inline',
  ENABLE_MOCK_PROVIDER: process.env.ENABLE_MOCK_PROVIDER || 'true',
  APP_URL: `http://localhost:${port}`,
};
const next = path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
const run = (args) => spawn(process.execPath, [next, ...args], { cwd: dir, env, stdio: 'inherit' });

if (mode === 'start') {
  const build = run(['build']);
  await new Promise((resolve, reject) =>
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`build exited ${code}`)),
    ),
  );
}
const server = run([mode, '-p', port]);
const timer = setInterval(() => {
  try {
    sync();
  } catch (error) {
    console.error('[preview] sync failed:', error);
  }
}, 1000);
const stop = () => {
  clearInterval(timer);
  server.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});
console.log(`[preview:${name}] ${mode} server in ${dir} -> http://localhost:${port}`);
