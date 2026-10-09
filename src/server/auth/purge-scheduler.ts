import 'server-only';
import { getDb } from '@/server/db';
import { getLogger, type Logger } from '@/server/logger';
import { resumeAccountPurges } from './account-deletion';
import { expireDeletedSignupAddresses } from './signup-guard';

/**
 * The housekeeping of deleted accounts, run by the server every hour. Deleting an account closes
 * it at once and erases its files and rows right after; when storage is unreachable or the
 * process stops in between, this sweep finishes the job, so "deleted" never depends on an
 * operator remembering `purge-deleted`. It also forgets the sign-up digests of deleted accounts
 * once their first day is over.
 */

export const PURGE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** The first sweep after start-up: soon enough to finish what a restart interrupted. */
export const PURGE_FIRST_SWEEP_DELAY_MS = 60 * 1000;

export interface PurgeSweepReport {
  /** Deleted accounts whose leftover content was worked on. */
  accountsPurged: number;
  /** Sign-up digests cleared. */
  signupAddressesCleared: number;
}

export async function runPurgeSweep(now: number = Date.now()): Promise<PurgeSweepReport> {
  const accountsPurged = await resumeAccountPurges();
  const signupAddressesCleared = expireDeletedSignupAddresses(getDb(), now);
  if (accountsPurged > 0 || signupAddressesCleared > 0) {
    getLogger().info('Deleted-account sweep finished', {
      component: 'auth',
      accountsPurged,
      signupAddressesCleared,
    });
  }
  return { accountsPurged, signupAddressesCleared };
}

interface Runtime {
  interval: ReturnType<typeof setInterval>;
  first: ReturnType<typeof setTimeout>;
  current: Promise<void> | undefined;
}

// On globalThis so Next.js dev HMR (which re-evaluates modules) cannot start a second sweeper.
const RUNTIME_KEY = Symbol.for('aivore.purge-scheduler');
type GlobalWithRuntime = typeof globalThis & { [RUNTIME_KEY]?: Runtime };

export interface PurgeSchedulerOptions {
  intervalMs?: number;
  firstSweepDelayMs?: number;
}

/**
 * Starts the periodic sweep (once per process; a second call changes nothing). A sweep that fails
 * is logged and tried again at the next interval; one that is still running makes the next tick
 * skip. The timers never keep the process alive.
 */
export function startAccountPurgeScheduler(log: Logger, options: PurgeSchedulerOptions = {}): void {
  const scope = globalThis as GlobalWithRuntime;
  if (scope[RUNTIME_KEY]) return;
  const sweep = (): void => {
    if (runtime.current) return;
    runtime.current = runPurgeSweep()
      .then(() => undefined)
      .catch((error: unknown) => {
        log.error('Deleted-account sweep failed; it will be retried', { err: error });
      })
      .finally(() => {
        runtime.current = undefined;
      });
  };
  const runtime: Runtime = {
    interval: setInterval(sweep, options.intervalMs ?? PURGE_SWEEP_INTERVAL_MS),
    first: setTimeout(sweep, options.firstSweepDelayMs ?? PURGE_FIRST_SWEEP_DELAY_MS),
    current: undefined,
  };
  runtime.interval.unref();
  runtime.first.unref();
  scope[RUNTIME_KEY] = runtime;
}

/** Stops the sweeps and waits for the one in flight. */
export async function stopAccountPurgeScheduler(): Promise<void> {
  const scope = globalThis as GlobalWithRuntime;
  const runtime = scope[RUNTIME_KEY];
  scope[RUNTIME_KEY] = undefined;
  if (!runtime) return;
  clearInterval(runtime.interval);
  clearTimeout(runtime.first);
  await runtime.current;
}

export function isAccountPurgeSchedulerRunning(): boolean {
  return (globalThis as GlobalWithRuntime)[RUNTIME_KEY] !== undefined;
}
