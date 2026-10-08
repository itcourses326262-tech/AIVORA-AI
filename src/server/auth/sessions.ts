// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

/** Revokes the session that belongs to `token` (the cookie value). Unknown tokens are ignored. */
export async function logout(_token: string): Promise<void> {
  throw new NotImplementedError('auth.logout');
}

/** Revokes every session of a user. */
export async function logoutAll(_userId: string): Promise<void> {
  throw new NotImplementedError('auth.logoutAll');
}
