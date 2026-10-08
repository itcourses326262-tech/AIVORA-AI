import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { NotImplementedError } from '@/lib/errors';
import { loginUrl } from '@/lib/next-path';
import { getLogger } from '@/server/logger';
import { getCurrentUser, type SessionUser } from '@/server/auth';

/**
 * A stand-in for the signed-in user while the real auth module is still a stub, in development
 * only, so the app shell and pages can be built and previewed before auth lands.
 */
export const PREVIEW_USER: SessionUser = {
  id: 'usr_preview00000000000000000',
  email: 'preview@aivore.local',
  name: 'Preview User',
  role: 'user',
  locale: 'en',
  creditBalance: 50,
};

interface Resolved {
  user: SessionUser | null;
  /** True when auth is not implemented yet (development only). */
  stubbed: boolean;
}

const isDevelopment = () => process.env.NODE_ENV === 'development';

/** One lookup per request, shared by the layout and the page. */
const resolveUser = cache(async (): Promise<Resolved> => {
  try {
    return { user: await getCurrentUser(), stubbed: false };
  } catch (error) {
    // In production (and tests) a failing session lookup must be loud: silently treating it as
    // "logged out" would sign everybody out during an outage.
    if (!isDevelopment()) throw error;
    const stubbed = error instanceof NotImplementedError;
    getLogger().warn(
      stubbed ? 'auth is not implemented yet; continuing without a user' : 'getCurrentUser failed',
      { err: error },
    );
    return { user: null, stubbed };
  }
});

/**
 * The signed-in user, or null. Use it where a visitor is fine (marketing header). A failure
 * counts as "no user" only in development (and is logged); elsewhere it throws.
 */
export async function getOptionalUser(): Promise<SessionUser | null> {
  return (await resolveUser()).user;
}

/**
 * The user the `(app)` area renders for. Same as {@link getOptionalUser}, except that in
 * development, while auth is still the unimplemented stub, it returns {@link PREVIEW_USER} so the
 * shell is visible. The moment auth exists this is exactly `getOptionalUser`.
 */
export async function getAppUser(): Promise<SessionUser | null> {
  const { user, stubbed } = await resolveUser();
  return user ?? (stubbed ? PREVIEW_USER : null);
}

/**
 * Page guard: call it at the top of every `(app)` page with the page's own path, e.g.
 * `await requireUser('/gallery')`, `await requireUser(`/gallery/${id}`)`. A visitor is redirected to
 * `/login?next=<path>` (layouts cannot know the path, which is why the guard lives in the page).
 */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getAppUser();
  if (!user) redirect(loginUrl(nextPath));
  return user;
}
