import type { RateLimitOptions } from '@/server/http/route';

/*
 * Budgets of the email-driven endpoints. Like the credential routes they are counted per client
 * address. When the address is unknown (no trusted proxy: every visitor looks alike) a budget sized
 * for one client would be a switch anyone can pull for everybody, so each route either gets a
 * `*_SHARED_*` budget sized for a bucket that all visitors share, or none where nothing it guards
 * could be abused (see the notes on each). The real defences are per account/link and live in the
 * services: a 60 s gap and an hourly budget of mails per account, outstanding-link caps, 256-bit
 * single-use links. The proper fix for a shared address is a reverse proxy with TRUST_PROXY=true.
 */

/** Asking for a new confirmation link. Per account; the 60 s resend gap is enforced in the service. */
export const VERIFY_REQUEST_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-verify-request',
  limit: 6,
  windowSec: 3600,
  by: 'user',
};

/**
 * Using a link: one HMAC and one indexed lookup, answered before anything expensive. The links are
 * 256-bit secrets, so guessing is not the risk this budget guards; it only bounds the lookups one
 * client can cause. With an unknown address there is NO shared budget on purpose: one bucket for
 * all visitors would let a script close confirmation for everybody (1200 junk requests an hour),
 * and a flood of junk costs the same as any other cheap anonymous request.
 */
export const VERIFY_CONFIRM_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-verify-confirm',
  limit: 30,
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

/**
 * Unknown address: one budget for the whole site. This is the one place where a shared bucket
 * stays, because without it a script could make the app mail every account it knows three times
 * an hour from a relay with a reputation to lose. The price is that 300 requests an hour from
 * anyone use it up and recovery answers 429 for everybody until the window ends: a deployment
 * behind a reverse proxy MUST set TRUST_PROXY=true (docs/ARCHITECTURE.md section 18). The
 * per-account mail budget lives in `requestPasswordReset`.
 */
export const FORGOT_SHARED_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-forgot-shared',
  limit: 300,
  windowSec: 3600,
  by: 'ip',
};

/**
 * Setting the new password. A wrong link is rejected before anything expensive happens (the hash
 * only runs for a link that is valid, and the hash gate caps those), so with an unknown address
 * there is no shared budget either: see {@link VERIFY_CONFIRM_RATE_LIMIT}.
 */
export const RESET_RATE_LIMIT: RateLimitOptions = {
  name: 'auth-reset',
  limit: 10,
  windowSec: 3600,
  by: 'ip',
};
