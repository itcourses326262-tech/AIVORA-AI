import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import type { CreateGenerationRequest, GenerationDTO, UserDTO } from '@/lib/api-types';
import { isTerminalStatus } from '@/lib/api-types';
import type { Db } from '@/server/db';
import { resetEnvForTests } from '@/server/env';
import { createJobRunner } from '@/server/jobs/worker';
import type { JobRunner, JobRunnerDeps } from '@/server/jobs/runner';
import { setProviderOverrides } from '@/server/providers/registry';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { setStorageOverride } from '@/server/storage';
import { freshDb } from '../../helpers/db';
import { Client, dataOf } from './api';
import { installTimeWarp, type TimeWarp } from './time-warp';

export const IMAGE_MODEL = 'aivore-demo-image';
export const VIDEO_MODEL = 'aivore-demo-video';

/** How much faster than the wall clock the Demo provider's latency and the runner's sleeps run. */
const DEFAULT_WARP = 10;
const PASSWORD = 'Correct-horse-battery-staple-9';

/** A registered account: a browser session with the cookie that registration issued. */
export class Member extends Client {
  constructor(
    readonly user: UserDTO,
    readonly email: string,
    readonly password: string,
    readonly token: string,
    /** The `Set-Cookie` headers of the registration response. */
    readonly setCookies: readonly string[],
  ) {
    super({ token });
  }
}

export interface RunnerOptions {
  tuning?: Partial<JobRunnerDeps['tuning']>;
  sleep?: JobRunnerDeps['sleep'];
  log?: JobRunnerDeps['log'];
  /** Replaces runner dependencies, e.g. `persistOutput`; `undefined` restores the real default. */
  deps?: Partial<JobRunnerDeps>;
}

export interface World {
  readonly db: Db;
  /** Where the real local storage driver keeps the files of this test. */
  readonly storageDir: string;
  readonly time: TimeWarp;
  anonymous(): Client;
  /** Registers an account through `POST /auth/register` and keeps the session it opened. */
  signUp(name?: string, options?: { locale?: 'ar' | 'en' }): Promise<Member>;
  /** A runner over the real database, storage and Demo provider; stopped after the test. */
  runner(options?: RunnerOptions): JobRunner;
  /** Relative paths of every file in storage, sorted. */
  storedFiles(): string[];
}

const offline = (): never => {
  throw new Error('The integration tests never touch the network');
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Real elapsed time: `Date.now()` is warped in these tests, so deadlines must not use it. */
const realNow = () => performance.now();

/** Polls `check` (real time) until it returns a value. */
export async function waitFor<T>(
  description: string,
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = realNow() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (realNow() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await wait(15);
  }
}

/**
 * Drives the runner with `tick()` until the generation is final, reading it through
 * `GET /generations/:id` like a client would. One tick runs a whole job (submit, polls, storing),
 * so the loop only repeats for jobs that were handed back (a requeue).
 */
export async function runToCompletion(
  client: Client,
  generationId: string,
  runner: JobRunner,
  timeoutMs = 45_000,
): Promise<GenerationDTO> {
  const read = async () => dataOf(await client.get<GenerationDTO>(`/generations/${generationId}`));
  return waitFor(
    `generation ${generationId} to finish`,
    async () => {
      const current = await read();
      if (isTerminalStatus(current.status)) return current;
      await runner.tick();
      const after = await read();
      return isTerminalStatus(after.status) ? after : undefined;
    },
    timeoutMs,
  );
}

export function textToImage(
  prompt: string,
  extra: Partial<CreateGenerationRequest> = {},
): CreateGenerationRequest {
  return { tool: 'text-to-image', modelId: IMAGE_MODEL, prompt, ...extra };
}

export function textToVideo(
  prompt: string,
  extra: Partial<CreateGenerationRequest> = {},
): CreateGenerationRequest {
  return { tool: 'text-to-video', modelId: VIDEO_MODEL, prompt, ...extra };
}

/**
 * One fresh world per test: an in-memory database, a real local storage directory, an empty rate
 * limiter, the real providers (nothing overridden) and a warped clock. Nothing from `@/server/auth`,
 * `@/server/security` or the engine is mocked.
 */
export function createWorld(options: { warp?: number } = {}): World {
  const database = freshDb();
  const runners: JobRunner[] = [];
  let directory = '';
  let time: TimeWarp | undefined;
  let emails = 0;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'aivore-integration-'));
    vi.stubEnv('STORAGE_LOCAL_DIR', directory);
    resetEnvForTests();
    setStorageOverride(null);
    setProviderOverrides(null);
    time = installTimeWarp(options.warp ?? DEFAULT_WARP);
    // After the warp: the limiter binds `Date.now` when it is constructed.
    setRateLimiter(new InMemoryRateLimiter());
  });

  afterEach(async () => {
    // Short grace: a runner left with a running job hands it back instead of waiting.
    await Promise.all(runners.splice(0).map((runner) => runner.stop()));
    time?.restore();
    setRateLimiter(null);
    setProviderOverrides(null);
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('The world is only available inside a test');
    return value;
  };

  return {
    get db() {
      return database.db;
    },
    get storageDir() {
      return directory;
    },
    get time() {
      return need(time);
    },
    anonymous: () => new Client(),
    async signUp(name = 'Alice', signUpOptions = {}) {
      emails += 1;
      const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}${emails}@example.com`;
      const reply = await new Client().post<UserDTO>('/auth/register', {
        email,
        password: PASSWORD,
        name,
        locale: signUpOptions.locale ?? 'en',
      });
      const user = dataOf(reply, 201);
      const setCookies = reply.headers.getSetCookie();
      const token = setCookies
        .map((line) => /^aivore_session=([^;]+)/.exec(line)?.[1])
        .find((value) => value !== undefined);
      if (token === undefined) throw new Error('Registration did not set the session cookie');
      return new Member(user, email, PASSWORD, token, setCookies);
    },
    runner(runnerOptions = {}) {
      const runner = createJobRunner({
        sleep: runnerOptions.sleep ?? need(time).sleep,
        ...(runnerOptions.log ? { log: runnerOptions.log } : {}),
        // Only the Demo provider may run here: anything that would reach the network fails loudly.
        fetch: offline,
        fetchOutput: offline,
        ...runnerOptions.deps,
        tuning: { shutdownGraceMs: 50, idleMs: 50, ...runnerOptions.tuning },
      });
      runners.push(runner);
      return runner;
    },
    storedFiles() {
      return readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
        .toSorted();
    },
  };
}
