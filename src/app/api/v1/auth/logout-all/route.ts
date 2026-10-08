import { clearSessionCookie } from '@/server/auth/cookies';
import { requireSession } from '@/server/auth/http';
import { logoutAll } from '@/server/auth/sessions';
import { noContent } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { LOGOUT_ALL_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `POST /api/v1/auth/logout-all` -> 204: signs the user out of every device, this one included. */
export const POST = route({ auth: 'required', rateLimit: LOGOUT_ALL_RATE_LIMIT }, async (ctx) => {
  requireSession(ctx.auth);
  await logoutAll(ctx.auth.user.id);
  return noContent({ headers: { 'Set-Cookie': clearSessionCookie() } });
});
