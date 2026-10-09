import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AccountDeletionModule from '@/server/auth/account-deletion';
import type * as LoggerModule from '@/server/logger';
import type { Logger } from '@/server/logger';
import { register } from '@/instrumentation';
import { deleteAccount, deleteAccountWithPassword } from '@/server/auth/account-deletion';
import { flushBackground } from '@/server/auth/background';
import {
  PURGE_FIRST_SWEEP_DELAY_MS,
  PURGE_SWEEP_INTERVAL_MS,
  isAccountPurgeSchedulerRunning,
  runPurgeSweep,
  startAccountPurgeScheduler,
  stopAccountPurgeScheduler,
} from '@/server/auth/purge-scheduler';
import { stopBillingScheduler } from '@/server/billing/scheduler';
import { assets, generations, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { resetEnvForTests } from '@/server/env';
import { setStorageOverride } from '@/server/storage';
import { freshDb } from '../../helpers/db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
  fakeStorage,
} from '../../helpers/factories';
import { GOOD_PASSWORD, mailTo, passwordFixture, trustTestState } from './trust-support';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  return { ...original, getLogger: () => ({ ...log, level: 'debug', child: () => log }) };
});
// Lets one test make the sweep itself fail (the database going away mid-run).
const sweep = vi.hoisted(() => ({ failWith: undefined as Error | undefined }));
vi.mock('@/server/auth/account-deletion', async (importOriginal) => {
  const original = await importOriginal<typeof AccountDeletionModule>();
  return {
    ...original,
    resumeAccountPurges: async (limit?: number) => {
      if (sweep.failWith) throw sweep.failWith;
      return original.resumeAccountPurges(limit);
    },
  };
});
const jobs = vi.hoisted(() => ({ startWorkerWithRetry: vi.fn() }));
vi.mock('@/server/jobs/start', () => ({ startWorkerWithRetry: jobs.startWorkerWithRetry }));

const harness = freshDb();
const fixture = passwordFixture();
trustTestState();

const logger = { ...log, level: 'debug', child: () => log } as unknown as Logger;
let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  sweep.failWith = undefined;
  storage = fakeStorage();
  setStorageOverride(storage);
  for (const fn of Object.values(log)) fn.mockClear();
  jobs.startWorkerWithRetry.mockReset().mockReturnValue({ workerId: 'worker-test' });
});
afterEach(async () => {
  vi.useRealTimers();
  await stopAccountPurgeScheduler();
  await stopBillingScheduler();
  setStorageOverride(null);
});

/** A person with one finished generation and its file in storage. */
async function withLibrary(email = 'layla@example.com') {
  const user = createUser(harness.db, {
    email,
    name: 'Layla',
    locale: 'en',
    passwordHash: fixture.hash,
  });
  const generation = createGeneration(harness.db, { userId: user.id, status: 'succeeded' });
  const output = createAsset(harness.db, {
    userId: user.id,
    role: 'output',
    generationId: generation.id,
  });
  await storage.put(output.storageKey, new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
  return { user, generation, output };
}

const contentOf = (userId: string) => ({
  assets: harness.db.select().from(assets).where(eq(assets.userId, userId)).all(),
  generations: harness.db.select().from(generations).where(eq(generations.userId, userId)).all(),
});

/** Makes every file removal fail until `fix()` is called (storage outage). */
function breakStorage() {
  const realDelete = storage.delete.bind(storage);
  let broken = true;
  storage.delete = async (key: string) => {
    if (broken) throw new Error('storage unreachable');
    await realDelete(key);
  };
  return {
    fix: () => {
      broken = false;
    },
  };
}

describe('the erasure no longer depends on the request or on an operator', () => {
  it('background mode closes the account at once and erases the library right after, off the request path', async () => {
    const a = await withLibrary();
    const result = await deleteAccount(a.user.id, { purge: 'background' });

    // The call returned with the account closed ...
    expect(result).toEqual({ alreadyDeleted: false, purge: null });
    expect(
      harness.db.select().from(users).where(eq(users.id, a.user.id)).get()?.deletedAt,
    ).not.toBe(null);
    // ... while the files were left to a later turn of the event loop.
    expect(contentOf(a.user.id).assets).toHaveLength(1);

    await flushBackground();
    expect(contentOf(a.user.id)).toEqual({ assets: [], generations: [] });
    expect(await storage.head(a.output.storageKey)).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      'Deleted account content erased',
      expect.objectContaining({ userId: a.user.id, assetsDeleted: 1 }),
    );
  });

  it('the self-service path accepts the same option and still checks the password first', async () => {
    const a = await withLibrary();
    await expect(
      deleteAccountWithPassword(a.user.id, 'not my password at all', { purge: 'background' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(contentOf(a.user.id).assets).toHaveLength(1);
    await expect(
      deleteAccountWithPassword(a.user.id, GOOD_PASSWORD, { purge: 'background' }),
    ).resolves.toEqual({ alreadyDeleted: false, purge: null });
    await flushBackground();
    expect(contentOf(a.user.id).assets).toEqual([]);
  });

  it('a storage outage is reported as such, and the sweep finishes the job when storage is back', async () => {
    const a = await withLibrary();
    const outage = breakStorage();
    await deleteAccount(a.user.id, { purge: 'background' });
    await flushBackground();

    // Nothing was lost silently: the leftovers are still listed, and the log says so.
    expect(contentOf(a.user.id).assets).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Deleted account content only partly erased; the purge scheduler retries',
      expect.objectContaining({ userId: a.user.id, assetsFailed: 1 }),
    );

    outage.fix();
    await expect(runPurgeSweep()).resolves.toMatchObject({ accountsPurged: 1 });
    expect(contentOf(a.user.id)).toEqual({ assets: [], generations: [] });
    await expect(runPurgeSweep()).resolves.toMatchObject({ accountsPurged: 0 });
  });

  it('does not tell the person the files are already gone when they are only being erased', async () => {
    const a = await withLibrary();
    breakStorage();
    await deleteAccount(a.user.id, { purge: 'background' });
    await flushBackground();
    const mail = await mailTo('layla@example.com');
    expect(mail).toMatchObject({ kind: 'account_deleted' });
    expect(mail?.text).toMatch(/being erased/);
    expect(mail?.text).not.toMatch(/together with every image and video/);
    expect(getOutbox()).toHaveLength(1);
  });

  it('says the same in Arabic', async () => {
    const a = await withLibrary();
    harness.db.update(users).set({ locale: 'ar' }).where(eq(users.id, a.user.id)).run();
    await deleteAccount(a.user.id, { purge: 'background' });
    await flushBackground();
    const mail = await mailTo('layla@example.com');
    expect(mail?.html).toContain('dir="rtl"');
    expect(mail?.text).toMatch(/تجري الآن إزالة/);
  });

  it('deleting an already deleted account in background mode still schedules the leftovers', async () => {
    const a = await withLibrary();
    const outage = breakStorage();
    await deleteAccount(a.user.id);
    outage.fix();
    await expect(deleteAccount(a.user.id, { purge: 'background' })).resolves.toEqual({
      alreadyDeleted: true,
      purge: null,
    });
    await flushBackground();
    expect(contentOf(a.user.id).assets).toEqual([]);
  });
});

describe('the scheduler', () => {
  it('sweeps once shortly after start-up and then every hour, and stops cleanly', async () => {
    vi.useFakeTimers();
    const a = await withLibrary();
    const outage = breakStorage();
    await deleteAccount(a.user.id);
    expect(contentOf(a.user.id).assets).toHaveLength(1);
    outage.fix();

    startAccountPurgeScheduler(logger);
    expect(isAccountPurgeSchedulerRunning()).toBe(true);
    // Not before the first delay ...
    await vi.advanceTimersByTimeAsync(PURGE_FIRST_SWEEP_DELAY_MS - 1);
    expect(contentOf(a.user.id).assets).toHaveLength(1);
    // ... then the leftovers are gone.
    await vi.advanceTimersByTimeAsync(1);
    expect(contentOf(a.user.id).assets).toEqual([]);

    // A later outage is caught by the next hourly sweep.
    const b = await withLibrary('omar@example.com');
    const secondOutage = breakStorage();
    await deleteAccount(b.user.id);
    secondOutage.fix();
    await vi.advanceTimersByTimeAsync(PURGE_SWEEP_INTERVAL_MS);
    expect(contentOf(b.user.id).assets).toEqual([]);

    await stopAccountPurgeScheduler();
    expect(isAccountPurgeSchedulerRunning()).toBe(false);
  });

  it('starting twice starts one sweeper', async () => {
    vi.useFakeTimers();
    const timers = vi.getTimerCount();
    startAccountPurgeScheduler(logger);
    const afterFirst = vi.getTimerCount();
    startAccountPurgeScheduler(logger);
    expect(vi.getTimerCount()).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(timers);
  });

  it('a failing sweep is logged, never thrown, and the next one still runs', async () => {
    vi.useFakeTimers();
    const a = await withLibrary();
    const outage = breakStorage();
    await deleteAccount(a.user.id);
    outage.fix();

    sweep.failWith = new Error('database went away');
    startAccountPurgeScheduler(logger, { intervalMs: 1_000, firstSweepDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(log.error).toHaveBeenCalledWith(
      'Deleted-account sweep failed; it will be retried',
      expect.objectContaining({ err: sweep.failWith }),
    );
    expect(contentOf(a.user.id).assets).toHaveLength(1);

    sweep.failWith = undefined;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(contentOf(a.user.id).assets).toEqual([]);
    expect(isAccountPurgeSchedulerRunning()).toBe(true);
  });

  it('a slow sweep is not started a second time on top of itself', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = await withLibrary();
    const outage = breakStorage();
    await deleteAccount(a.user.id);
    outage.fix();
    const realDelete = storage.delete.bind(storage);
    storage.delete = async (key: string) => {
      calls += 1;
      await gate;
      await realDelete(key);
    };

    startAccountPurgeScheduler(logger, { intervalMs: 100, firstSweepDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(1_000); // ten more ticks while the first sweep is stuck
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(contentOf(a.user.id).assets).toEqual([]);
  });
});

describe('start-up wiring (src/instrumentation.ts)', () => {
  function bootWith(mode: string) {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('WORKER_MODE', mode);
    resetEnvForTests();
    return register();
  }

  it.each(['inline', 'external'])('starts the sweeper with WORKER_MODE=%s', async (mode) => {
    await bootWith(mode);
    expect(isAccountPurgeSchedulerRunning()).toBe(true);
  });

  it('does not start it with WORKER_MODE=off (tests, tools that must not run background work)', async () => {
    await bootWith('off');
    expect(isAccountPurgeSchedulerRunning()).toBe(false);
  });

  it('does not start it outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(isAccountPurgeSchedulerRunning()).toBe(false);
  });

  it('a session of the deleted account is dead the moment the call returns, before any purge', async () => {
    const a = await withLibrary();
    const session = createSession(harness.db, a.user.id);
    await deleteAccount(a.user.id, { purge: 'background' });
    const { resolveSession } = await import('@/server/auth/sessions');
    expect(resolveSession(session.token, harness.db)).toBeNull();
    await flushBackground();
  });
});
