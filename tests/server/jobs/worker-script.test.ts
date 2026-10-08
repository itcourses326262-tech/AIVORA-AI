import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generations } from '@/server/db/schema';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';
import { queue } from '../generations/support';

// `scripts/worker.ts` as a real operating-system process, the way `npm run worker` and the Docker
// worker service run it: it must pick up jobs from the shared database, finish them, and stop
// cleanly on SIGTERM.

const ROOT = resolve(import.meta.dirname, '../../..');
type Child = ChildProcessByStdio<null, Readable, Readable>;

let test: TestDb;
let mediaDir: string;
let child: Child | undefined;
let output = '';

function startWorker(env: Record<string, string> = {}): Child {
  output = '';
  child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=react-server', 'scripts/worker.ts'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_PATH: test.path,
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: mediaDir,
        ENABLE_MOCK_PROVIDER: 'true',
        WORKER_MODE: 'external',
        LOG_LEVEL: 'info',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return child;
}

function exited(
  process_: Child,
  timeoutMs = 20_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`worker did not exit in time. Output:\n${output}`)),
      timeoutMs,
    );
    process_.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function until(condition: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. Output:\n${output}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

const statusOf = (id: string) =>
  test.db.select().from(generations).where(eq(generations.id, id)).get();

beforeEach(() => {
  test = createTestDb({ file: true });
  mediaDir = mkdtempSync(join(tmpdir(), 'aivore-worker-media-'));
});

afterEach(() => {
  child?.kill('SIGKILL');
  child = undefined;
  test.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

describe('scripts/worker.ts', () => {
  it('runs queued jobs from the shared database and stops cleanly on SIGTERM', async () => {
    const user = seedUser(test.db, { creditBalance: 20 });
    const job = queue(test.db, user, { prompt: 'a lamp on a desk __sync__' });

    const worker = startWorker();
    await until(() => statusOf(job.id)?.status === 'succeeded', 'the job to succeed');
    expect(output).toContain('Worker started');
    expect(statusOf(job.id)).toMatchObject({ progress: 100, attempts: 1 });

    // A job queued while it runs is picked up too (within the idle interval).
    const later = queue(test.db, user, { prompt: 'a second lamp __sync__' });
    await until(() => statusOf(later.id)?.status === 'succeeded', 'the second job to succeed');

    worker.kill('SIGTERM');
    const { code } = await exited(worker);
    expect(code).toBe(0);
    expect(output).toContain('Worker stopping');
    expect(output).toContain('Job runner stopped');
  }, 90_000);

  it('hands a running job back to the queue when it is stopped, so the next worker can resume it', async () => {
    const user = seedUser(test.db, { creditBalance: 20 });
    // `__slow__` keeps the Demo job running for 25 s, longer than the 8 s grace period.
    const job = queue(test.db, user, { prompt: 'a slow river __slow__' });

    const worker = startWorker();
    await until(() => Boolean(statusOf(job.id)?.providerJobId), 'the job to be submitted');
    expect(statusOf(job.id)?.status).toBe('processing');

    worker.kill('SIGTERM');
    const { code } = await exited(worker, 30_000);
    expect(code).toBe(0);
    expect(statusOf(job.id)).toMatchObject({
      status: 'queued',
      workerId: null,
      leaseUntil: null,
      attempts: 0,
    });
    expect(statusOf(job.id)?.providerJobId).toBeTruthy();
  }, 90_000);

  it('exits at once on a second signal', async () => {
    const user = seedUser(test.db, { creditBalance: 20 });
    const job = queue(test.db, user, { prompt: 'a slow river __slow__' });
    const worker = startWorker();
    await until(() => Boolean(statusOf(job.id)?.providerJobId), 'the job to be submitted');

    const done = exited(worker, 30_000);
    worker.kill('SIGTERM');
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    worker.kill('SIGINT');
    expect((await done).code).toBe(1);
    expect(output).toContain('Second stop request');
  }, 90_000);

  it('refuses to start with an invalid configuration and says why', async () => {
    const worker = startWorker({ WORKER_CONCURRENCY: 'lots' });
    const { code } = await exited(worker);
    expect(code).toBe(1);
    expect(output).toContain('WORKER_CONCURRENCY');
  }, 60_000);

  it('warns when the web server is also configured to run jobs inline', async () => {
    const worker = startWorker({ WORKER_MODE: 'inline' });
    await until(() => output.includes('Worker started'), 'start-up');
    worker.kill('SIGTERM');
    await exited(worker);
    expect(output).toContain('WORKER_MODE=inline');
  }, 60_000);
});
