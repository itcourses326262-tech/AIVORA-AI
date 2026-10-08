// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { Locale } from '@/lib/i18n/locales';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  locale: Locale;
  creditBalance: number;
}

export interface AuthContext {
  user: SessionUser;
  via: 'session' | 'api_key';
  sessionId?: string;
  apiKeyId?: string;
}

/** Bearer `avk_…` -> API key; otherwise the `aivore_session` cookie. Null when unauthenticated. */
export async function authenticate(_req: Request): Promise<AuthContext | null> {
  throw new NotImplementedError('auth.authenticate');
}

/** The signed-in user of the current request, for server components (reads `cookies()`). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  throw new NotImplementedError('auth.getCurrentUser');
}
