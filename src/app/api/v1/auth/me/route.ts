import { toUserDTO } from '@/server/auth/dto';
import { addressRoute } from '@/server/auth/address-route';
import { getUserById } from '@/server/auth/users';
import { ok } from '@/server/http/respond';
import { ME_RATE_LIMIT, ME_SHARED_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/auth/me` -> `{ data: UserDTO }`, or `{ data: null }` for visitors (never a 401, so
 * the UI can ask on every page). It never touches the session cookie: that one is issued once, at
 * login, with a lifetime that outlasts the sliding session.
 */
export const GET = addressRoute(
  { auth: 'optional' },
  { perAddress: ME_RATE_LIMIT, sharedAddress: ME_SHARED_RATE_LIMIT },
  async (ctx) => {
    const row = ctx.auth ? getUserById(ctx.auth.user.id) : undefined;
    return ok(row ? toUserDTO(row) : null);
  },
);
