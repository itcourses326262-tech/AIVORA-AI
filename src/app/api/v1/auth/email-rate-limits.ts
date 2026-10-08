import type { RateLimitOptions } from '@/server/http/route';

/*
 * Budgets of the email-driven endpoints. Like the credential routes they are counted per client
 * address and have a `*_SHARED_*` twin for when the address is unknown (no trusted proxy: every
 * visitor looks alike, so a budget sized for one client would be a switch anyone can pull for
 * everybody; see rate-limits.ts in this folder). The real defences are per account/email and live
 * in the services: a 60 s gap between mails, outstanding-link caps and the per-email budget below.
 */

/** Asking for a new confirmation link. Per account; the 60 s resend gap is enforced in the service. */
export const VERIFY_REQUEST_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-verify-request',
  limit: 6,
  windowSec: 3600,
  by: 'user',
};

/** Using a link: one cheap indexed lookup, but a guessing attempt, so it is bounded per address. */
export const VERIFY_CONFIRM_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-verify-confirm',
  limit: 30,
  windowSec: 3600,
  by: 'ip',
};
export const VERIFY_CONFIRM_SHARED_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-verify-confirm-shared',
  limit: 1200,
  windowSec: 3600,
  by: 'ip',
};

/** "Forgot password": mail goes out, so it is tight per address. */
export const FORGOT_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-forgot',
  limit: 10,
  windowSec: 3600,
  by: 'ip',
};
/** Unknown address: one budget for the whole site; bounds the mail volume a script can cause. */
export const FORGOT_SHARED_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-forgot-shared',
  limit: 300,
  windowSec: 3600,
  by: 'ip',
};

/**
 * Per target mailbox (canonical form), however many addresses the requests come from. Exhausting
 * it is not reported: the response stays the same 202, so the budget cannot be probed for accounts.
 */
export const FORGOT_EMAIL_LIMIT = { name: 'auth-forgot-email', limit: 3, windowSec: 3600 } as const;

/** Setting the new password: each attempt with a wrong link is a guess, each valid one costs scrypt. */
export const RESET_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-reset',
  limit: 10,
  windowSec: 3600,
  by: 'ip',
};
export const RESET_SHARED_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-reset-shared',
  limit: 600,
  windowSec: 3600,
  by: 'ip',
};
