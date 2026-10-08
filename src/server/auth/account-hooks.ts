import 'server-only';
import { AppError } from '@/lib/errors';
import type { Locale } from '@/lib/i18n/locales';
import { getLogger } from '@/server/logger';

/**
 * The extension point for modules that hold things which must end with an account (the billing
 * module cancels a Moyasar subscription here). Register with {@link onAccountDeleted} when your
 * module starts, NOT at import time (modules have no top-level side effects); registering the same
 * `name` again replaces the earlier handler, so hot reloads and repeated start-up are harmless.
 *
 * Handlers run BEFORE anything is destroyed. If one throws (or takes longer than the time limit),
 * the deletion stops with a 502 and the account is untouched, so the user can simply try again:
 * deleting an account must never leave a subscription that keeps charging. A handler must be
 * idempotent, because that retry runs it again.
 */
export interface AccountDeletedEvent {
  userId: string;
  /** The address before it is replaced by a tombstone. */
  email: string;
  locale: Locale;
}

export type AccountDeletedHandler = (event: AccountDeletedEvent) => void | Promise<void>;

const REGISTRY_KEY = Symbol.for('aivore.account-deleted-hooks');
type GlobalWithHooks = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, AccountDeletedHandler>;
};

function registry(): Map<string, AccountDeletedHandler> {
  const scope = globalThis as GlobalWithHooks;
  return (scope[REGISTRY_KEY] ??= new Map());
}

/** Registers `handler` under `name`. Returns a function that removes it again. */
export function onAccountDeleted(name: string, handler: AccountDeletedHandler): () => void {
  registry().set(name, handler);
  return () => {
    if (registry().get(name) === handler) registry().delete(name);
  };
}

/** Names of the registered handlers, in registration order. */
export function listAccountDeletedHooks(): string[] {
  return [...registry().keys()];
}

/** Handlers get this long each. */
export const HOOK_TIMEOUT_MS = 20_000;

function withDeadline(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Runs every handler (all of them, even after a failure, so one broken module does not hide
 * another's problem), then throws `provider_error` (502) if any failed.
 */
export async function runAccountDeletedHooks(
  event: AccountDeletedEvent,
  timeoutMs: number = HOOK_TIMEOUT_MS,
): Promise<void> {
  const failed: string[] = [];
  for (const [name, handler] of [...registry()]) {
    try {
      await withDeadline(
        Promise.resolve().then(() => handler(event)),
        timeoutMs,
      );
    } catch (err) {
      failed.push(name);
      getLogger().error('An account deletion hook failed', {
        component: 'auth',
        hook: name,
        userId: event.userId,
        err,
      });
    }
  }
  if (failed.length > 0) {
    throw AppError.of(
      'provider_error',
      'The account could not be deleted yet because a connected service did not respond. Try again.',
      { hooks: failed },
    );
  }
}
