// OWNER: engine — real wiring (the behaviour lives in runner.ts)
import 'server-only';
import { getDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { getProvider } from '@/server/providers/registry';
import { getStorage } from '@/server/storage';
import { JobRunner, type JobRunnerDeps } from './runner';

/** A runner wired to the process-wide database, storage, providers, env and logger. */
export function createJobRunner(overrides: Partial<JobRunnerDeps> = {}): JobRunner {
  return new JobRunner({
    db: getDb(),
    storage: getStorage(),
    providers: { getProvider },
    env: getEnv(),
    // A caller that passes its own `env` gets exactly that env for every job.
    ...(overrides.env ? {} : { readEnv: getEnv }),
    log: getLogger().child({ component: 'worker' }),
    ...overrides,
  });
}
