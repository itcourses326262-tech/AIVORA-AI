// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { Locale } from '@/lib/i18n/locales';
import type { SessionUser } from './context';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  locale: Locale;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Client details stored with the session. */
export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthResult {
  user: SessionUser;
  /** The session cookie value. Shown to the client once; only its hash is stored. */
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

/**
 * Creates the account, grants the signup bonus in the same transaction (first `ADMIN_EMAILS`
 * match becomes admin) and opens a session. `conflict` for a taken email, `signup_disabled` when
 * registration is closed, `validation_failed` for a bad email or password.
 */
export async function registerUser(
  _input: RegisterInput,
  _meta?: SessionMeta,
): Promise<AuthResult> {
  throw new NotImplementedError('auth.registerUser');
}

/** Constant-time-ish, with one generic `unauthorized` error for every failure. Rate limited per IP+email. */
export async function loginUser(_input: LoginInput, _meta?: SessionMeta): Promise<AuthResult> {
  throw new NotImplementedError('auth.loginUser');
}

/**
 * Verifies `current`, applies the password policy to `next` and stores the new hash. Every session
 * of the user except `keepSessionId` (the caller's own) is revoked.
 */
export async function changePassword(
  _userId: string,
  _current: string,
  _next: string,
  _keepSessionId?: string,
): Promise<void> {
  throw new NotImplementedError('auth.changePassword');
}
