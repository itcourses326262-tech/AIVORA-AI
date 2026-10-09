import { addressRoute } from '@/server/auth/address-route';
import { toUserDTO } from '@/server/auth/dto';
import { isFirebaseAuthEnabled } from '@/server/auth/firebase';
import { signInWithFirebase } from '@/server/auth/firebase-login';
import { retireRequestSession, sessionHeaders } from '@/server/auth/http';
import { newAccountBudget } from '@/server/auth/new-account-budget';
import { AUTH_BODY_LIMIT, firebaseLoginSchema } from '@/server/auth/schemas';
import { getUserById } from '@/server/auth/users';
import { AppError } from '@/lib/errors';
import { localeFromHeaders } from '@/lib/i18n';
import { errorResponse } from '@/server/http/errors';
import { requestIdOf } from '@/server/http/request';
import { ok } from '@/server/http/respond';
import type { RouteHandler } from '@/server/http/route';
import { UNKNOWN_IP } from '@/server/security/ip';
import { FIREBASE_LOGIN_RATE_LIMIT, REGISTER_SHARED_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const signIn = addressRoute(
  { auth: 'none', csrf: true, maxBodyBytes: AUTH_BODY_LIMIT },
  { perAddress: FIREBASE_LOGIN_RATE_LIMIT, sharedAddress: false },
  async (ctx) => {
    const body = await ctx.body(firebaseLoginSchema);
    // Without a trusted proxy there is no per-address budget to cap sign-ups, so the hourly budget
    // of registration applies, spent only by accounts this call creates (see `newAccountBudget`).
    const signups =
      ctx.ip === UNKNOWN_IP ? newAccountBudget(REGISTER_SHARED_RATE_LIMIT, `ip:${ctx.ip}`) : null;
    let result;
    try {
      result = await signInWithFirebase(
        { idToken: body.idToken, locale: body.locale ?? localeFromHeaders(ctx.req.headers) },
        { ip: ctx.ip, userAgent: ctx.req.headers.get('user-agent') ?? undefined },
        { admitNewAccount: signups?.admit },
      );
    } catch (error) {
      signups?.settle(false);
      throw error;
    }
    signups?.settle(result.created);
    await retireRequestSession(ctx.req);

    const row = getUserById(result.user.id);
    if (!row) throw AppError.of('internal', 'Account missing right after Google sign-in');
    return ok(toUserDTO(row), { headers: sessionHeaders(result.token, row.locale) });
  },
);

/**
 * `POST /api/v1/auth/firebase` `{ idToken, locale? }` -> `{ data: UserDTO }` plus the session and
 * locale cookies, exactly like `/auth/login`. `idToken` is the Firebase ID token the browser got
 * from the Google popup; it is verified here against Google's public keys and the person gets
 * their account (found by the linked Google identity or by the mailbox, otherwise created, with
 * the same sign-up rules as registration). Anything wrong with the token is the same 401.
 *
 * While Google sign-in is not configured (or switched off with `FIREBASE_AUTH=off`) a POST answers
 * the same 404 as an unknown path, before the request is looked at: no cookie, no budget spent,
 * nothing created, whatever the body. It does not hide that the route exists (a GET answers Next's
 * 405 for a route without a GET handler); it only does nothing. Not in the OpenAPI document: it
 * serves the sign-in page, not developers.
 *
 * Rate limits: 10 attempts a minute per client address. Where the address is unknown (no trusted
 * proxy) there is no address-wide attempt budget, but a new account spends the hourly sign-up
 * budget of registration (60 an hour for the whole site, returning people never spend it).
 */
export const POST: RouteHandler<Record<string, never>> = async (req, nextCtx) => {
  if (!isFirebaseAuthEnabled()) {
    const response = errorResponse(AppError.of('not_found', 'Not found'));
    response.headers.set('X-Request-Id', requestIdOf(req));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  return signIn(req, nextCtx);
};
