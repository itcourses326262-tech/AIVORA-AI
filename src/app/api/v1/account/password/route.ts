import { requireSession } from '@/server/auth/http';
import { AUTH_BODY_LIMIT, changePasswordSchema } from '@/server/auth/schemas';
import { changePassword } from '@/server/auth/users';
import { noContent } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { PASSWORD_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/account/password` `{ currentPassword, newPassword }` -> 204. Every OTHER session
 * of the account is revoked; the one that made the request stays signed in. Session only.
 */
export const POST = route(
  { auth: 'required', rateLimit: PASSWORD_RATE_LIMIT, maxBodyBytes: AUTH_BODY_LIMIT },
  async (ctx) => {
    const sessionId = requireSession(ctx.auth);
    const body = await ctx.body(changePasswordSchema);
    await changePassword(ctx.auth.user.id, body.currentPassword, body.newPassword, sessionId);
    return noContent();
  },
);
