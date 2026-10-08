import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, beforeEach, vi } from 'vitest';
import { closeDb } from '@/server/db';
import { resetEnvForTests } from '@/server/env';
import { ISOLATED_ENV_KEYS } from '../../helpers/isolated-env';

const ROOT = resolve(import.meta.dirname, '../../..');

export interface WorkerProcess {
  readonly output: () => string;
  /** Resolves when the process ends. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill(signal: NodeJS.Signals): void;
}

export interface ExternalWorkers {
  /** Starts `scripts/worker.ts` as its own OS process, the way `npm run worker` does. */
  spawn(): WorkerProcess;
}

/**
 * Call at the top of a `describe` (after `createWorld`). Moves the process-wide database to a file
 * on disk, so separate worker processes can share it with the route handlers of the test, and kills
 * every worker the test started. `mediaDir` is the directory of the storage driver in use.
 */
export function externalWorkers(mediaDir: () => string): ExternalWorkers {
  let directory = '';
  let databasePath = '';
  const children: Array<ChildProcessByStdio<null, Readable, Readable>> = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'aivore-external-db-'));
    databasePath = join(directory, 'aivore.db');
    closeDb();
    vi.stubEnv('DATABASE_PATH', databasePath);
    resetEnvForTests();
  });

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
    closeDb();
    rmSync(directory, { recursive: true, force: true });
  });

  return {
    spawn() {
      let output = '';
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', '--conditions=react-server', 'scripts/worker.ts'],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            ...Object.fromEntries(ISOLATED_ENV_KEYS.map((key) => [key, ''])),
            DATABASE_PATH: databasePath,
            STORAGE_DRIVER: 'local',
            STORAGE_LOCAL_DIR: mediaDir(),
            ENABLE_MOCK_PROVIDER: 'true',
            WORKER_MODE: 'external',
            WORKER_CONCURRENCY: '2',
            LOG_LEVEL: 'info',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      children.push(child);
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      return {
        output: () => output,
        exited: new Promise((resolveExit) => {
          child.once('exit', (code, signal) => resolveExit({ code, signal }));
        }),
        kill: (signal) => {
          child.kill(signal);
        },
      };
    },
  };
}
