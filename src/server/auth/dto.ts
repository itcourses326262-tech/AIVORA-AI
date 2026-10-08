import 'server-only';
import type { UserDTO } from '@/lib/api-types';
import type { UserRow } from '@/server/db/schema';
import type { SessionUser } from './context';

/** What the server keeps about the signed-in user for the length of a request. */
export function toSessionUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    creditBalance: user.creditBalance,
  };
}

/** The public shape of an account (`GET /auth/me`, `GET /account`). Never includes the hash. */
export function toUserDTO(user: UserRow): UserDTO {
  return { ...toSessionUser(user), createdAt: user.createdAt };
}
