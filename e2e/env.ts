/**
 * What the end-to-end servers are started with and what the specs rely on, in one place: the
 * config (`playwright.config.ts`) starts the servers from it and the specs assert against it, so
 * the two cannot drift apart.
 *
 * Next loads `.env.local` and `.env` even in production mode, and a variable that is already
 * defined (even as an empty string) is never overwritten by dotenv. Everything a spec assumes is
 * therefore PINNED here, not left to a default: an owner who tunes `MAX_ACTIVE_PER_USER` in
 * `.env.local` for production must not get an unexplained failure from `npm run test:e2e`.
 */

/** The server's `SESSION_SECRET`. The security spec searches every page for it, so it is shared. */
export const E2E_SESSION_SECRET = 'e2e-session-secret-0123456789abcdef0123456789abcdef';

/** Limits and rates the specs assume. Each is also set in the server's environment. */
export const E2E_LIMITS = {
  signupBonusCredits: 50,
  /** Generations one account may have queued or running at once. */
  maxActivePerUser: 4,
  /** The largest picture a user may upload. */
  maxUploadMb: 10,
  vatRatePercent: 15,
} as const;

/** The pinned, non-secret tunables of the server (environment variable -> value). */
export const E2E_PINNED_ENV: Readonly<Record<string, string>> = {
  SIGNUP_ENABLED: 'true',
  SIGNUP_BONUS_CREDITS: String(E2E_LIMITS.signupBonusCredits),
  MAX_ACTIVE_PER_USER: String(E2E_LIMITS.maxActivePerUser),
  MAX_UPLOAD_MB: String(E2E_LIMITS.maxUploadMb),
  VAT_RATE_PERCENT: String(E2E_LIMITS.vatRatePercent),
  // Retries of a failing generation and its time limits: the failure specs count attempts.
  MAX_ATTEMPTS: '3',
  GENERATION_TIMEOUT_SEC_IMAGE: '180',
  GENERATION_TIMEOUT_SEC_VIDEO: '900',
  // A spending cap would turn paid-provider refusals into 503s; the Demo provider is never capped,
  // but the run must not depend on what an owner put in `.env.local`.
  DAILY_UPSTREAM_BUDGET_CREDITS: '0',
};

/** File names inside the run's scratch directory (`AIVORE_E2E_DIR`). */
export const E2E_FILES = {
  /** Mail the server writes when no SMTP relay is configured (the default project). */
  outbox: 'outbox.jsonl',
  /** Mail the SMTP sink received from the server of the `smtp` project. */
  smtpSink: 'smtp-sink.jsonl',
} as const;

/** Where the three processes of a run listen, derived from the base port. */
export function e2ePorts(base: number): { app: number; smtpApp: number; smtpSink: number } {
  return { app: base, smtpApp: base + 1, smtpSink: base + 2 };
}
