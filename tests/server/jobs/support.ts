import { vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { getBalance } from '@/server/credits';
import type { Db } from '@/server/db';
import {
  generations,
  type GenerationRow,
  type NewGenerationRow,
  type UserRow,
} from '@/server/db/schema';
import { parseEnv, type Env } from '@/server/env';
import { JobRunner, type JobRunnerDeps } from '@/server/jobs/runner';
import { createLogger, type Logger } from '@/server/logger';
import type { safeFetch } from '@/server/security/ssrf';
import type { persistOutput } from '@/server/uploads';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';
import {
  fakeProvider,
  fakeStorage,
  type FakeProvider,
  type FakeStorage,
} from '../../helpers/fakes';
import { queue } from '../generations/support';

interface Timer {
  at: number;
  fire(): void;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Milliseconds until each pending timer fires, soonest first. */
  pending(): number[];
  /** Moves time forward, firing every timer that falls due on the way. */
  advance(ms: number): Promise<void>;
  /** Moves time forward timer by timer until `promise` settles. */
  runUntil<T>(promise: Promise<T>, options?: { maxSteps?: number }): Promise<T>;
  /** Every duration passed to `sleep`, in order. */
  readonly sleeps: number[];
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) await turn();
}

/**
 * A virtual clock for the runner's `now` and `sleep`: nothing waits in real time, tests decide
 * when a timer fires. A sleep rejects with the signal's reason when its signal aborts, like the
 * real one.
 */
export function createClock(start = 1_800_000_000_000): Clock {
  let current = start;
  const timers = new Set<Timer>();
  const sleeps: number[] = [];

  const sleep: Clock['sleep'] = (ms, signal) => {
    sleeps.push(ms);
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const timer: Timer = {
        at: current + Math.max(0, ms),
        fire() {
          timers.delete(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        timers.delete(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timers.add(timer);
    });
  };

  const soonest = (limit = Infinity): Timer | undefined =>
    [...timers].filter((timer) => timer.at <= limit).sort((a, b) => a.at - b.at)[0];

  const clock: Clock = {
    now: () => current,
    sleep,
    sleeps,
    pending: () => [...timers].map((timer) => timer.at - current).sort((a, b) => a - b),
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        await flush();
        const next = soonest(target);
        if (!next) break;
        current = Math.max(current, next.at);
        next.fire();
      }
      current = target;
      await flush();
    },
    async runUntil(promise, { maxSteps = 5000 } = {}) {
      let settled = false;
      promise.then(
        () => (settled = true),
        () => (settled = true),
      );
      let idleTurns = 0;
      for (let step = 0; step < maxSteps && !settled; step += 1) {
        await flush();
        if (settled) break;
        const next = soonest();
        if (next) {
          idleTurns = 0;
          await clock.advance(Math.max(0, next.at - current));
        } else if (++idleTurns > 400) {
          throw new Error('runUntil: nothing is scheduled and the promise is still pending');
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      if (!settled) throw new Error(`runUntil: still pending after ${maxSteps} steps`);
      return promise;
    },
  };
  return clock;
}

export interface RecordedLog {
  level: string;
  msg: string;
  fields: Record<string, unknown>;
}

/** A logger that keeps what it is given, so tests can check what was (and was not) logged. */
export function recordingLogger(): { log: Logger; lines: RecordedLog[]; text(): string } {
  const lines: RecordedLog[] = [];
  const raw: string[] = [];
  const log = createLogger({
    level: 'debug',
    sink(level, line) {
      raw.push(line);
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const { msg, level: _level, time: _time, ...fields } = parsed;
      lines.push({ level, msg: String(msg), fields });
    },
  });
  return { log, lines, text: () => raw.join('\n') };
}

/** `persistOutput` without sharp: stores the bytes as they are and reports a PersistedOutput. */
export function fakePersist(): ReturnType<typeof vi.fn<typeof persistOutput>> {
  return vi.fn<typeof persistOutput>(async (storage, input) => {
    const assetId = newId('ast');
    if (!(input.bytes instanceof Uint8Array)) throw new Error('fakePersist only takes buffers');
    const { bytes } = input;
    const storageKey = `u/${input.userId}/${input.generationId}/${assetId}.png`;
    await storage.put(storageKey, bytes, { mimeType: input.mimeType });
    return {
      assetId,
      index: input.index,
      kind: input.kind,
      storageKey,
      mimeType: input.mimeType,
      bytes: bytes.byteLength,
      ...(input.width === undefined ? {} : { width: input.width }),
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    };
  });
}

export interface HarnessOptions {
  provider?: FakeProvider;
  env?: Record<string, string>;
  /** Use the storage module's real `persistOutput` (sharp) instead of {@link fakePersist}. */
  realPersist?: boolean;
  fetchOutput?: typeof safeFetch;
  fetch?: typeof fetch;
  tuning?: JobRunnerDeps['tuning'];
  /** Starting credits of the test user. */
  balance?: number;
  /** Fixed jitter source; 0.5 means "no jitter" in the backoff arithmetic. */
  random?: () => number;
}

export interface Harness {
  test: TestDb;
  db: Db;
  user: UserRow;
  storage: FakeStorage;
  provider: FakeProvider;
  clock: Clock;
  env: Env;
  runner: JobRunner;
  persist: ReturnType<typeof fakePersist>;
  logs: ReturnType<typeof recordingLogger>;
  /** A queued, already paid generation (see `queue`). */
  enqueue(overrides?: Partial<NewGenerationRow>): GenerationRow;
  row(id: string): GenerationRow;
  balance(): number;
  /** A second runner over the same database, e.g. the worker that comes up after a crash. */
  another(overrides?: Partial<JobRunnerDeps>): JobRunner;
  close(): void;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const test = createTestDb();
  const user = seedUser(test.db, { creditBalance: options.balance ?? 50 });
  const storage = fakeStorage();
  const provider = options.provider ?? fakeProvider();
  const clock = createClock();
  const env = parseEnv({
    ...process.env,
    WORKER_CONCURRENCY: '2',
    MAX_ATTEMPTS: '3',
    GENERATION_TIMEOUT_SEC_IMAGE: '180',
    GENERATION_TIMEOUT_SEC_VIDEO: '900',
    ...options.env,
  });
  const logs = recordingLogger();
  const persist = fakePersist();

  const deps = (overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps => ({
    db: test.db,
    storage,
    providers: { getProvider: () => provider },
    env,
    log: logs.log,
    now: clock.now,
    sleep: clock.sleep,
    random: options.random ?? (() => 0.5),
    ...(options.realPersist ? {} : { persistOutput: persist }),
    ...(options.fetchOutput ? { fetchOutput: options.fetchOutput } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.tuning ? { tuning: options.tuning } : {}),
    ...overrides,
  });

  return {
    test,
    db: test.db,
    user,
    storage,
    provider,
    clock,
    env,
    logs,
    persist,
    runner: new JobRunner(deps()),
    enqueue: (overrides = {}) => queue(test.db, user, overrides),
    row: (id) =>
      test.db.select().from(generations).where(eq(generations.id, id)).get() as GenerationRow,
    balance: () => getBalance(test.db, user.id),
    another: (overrides) => new JobRunner(deps(overrides)),
    close: () => test.close(),
  };
}

/** A promise you resolve yourself. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Resolves on the next macrotask turns, letting queued microtasks and I/O callbacks run. */
export async function settle(turns = 6): Promise<void> {
  for (let round = 0; round < turns; round += 1) await turn();
}
