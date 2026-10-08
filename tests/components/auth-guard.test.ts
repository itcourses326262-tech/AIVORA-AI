import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotImplementedError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/server/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/server/logger', () => ({ getLogger: () => ({ warn: mocks.warn }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

import { PREVIEW_USER, getAppUser, getOptionalUser, requireUser } from '@/lib/auth-guard';

const LAYLA = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user' as const,
  locale: 'en' as const,
  creditBalance: 50,
};

beforeEach(() => {
  mocks.getCurrentUser.mockReset();
  mocks.warn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('with a working auth module', () => {
  it('requireUser returns the user', async () => {
    mocks.getCurrentUser.mockResolvedValue(LAYLA);
    await expect(requireUser('/gallery')).resolves.toEqual(LAYLA);
  });

  it('requireUser sends a visitor to /login?next=<the page they asked for>', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requireUser('/gallery/gen_1')).rejects.toThrow(
      'NEXT_REDIRECT /login?next=%2Fgallery%2Fgen_1',
    );
  });

  it('requireUser drops an unsafe next path instead of echoing it', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requireUser('//evil.example')).rejects.toThrow('NEXT_REDIRECT /login');
  });

  it('getOptionalUser and getAppUser return null for a visitor', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(getOptionalUser()).resolves.toBeNull();
    await expect(getAppUser()).resolves.toBeNull();
  });
});

describe('when the session lookup fails', () => {
  it.each(['production', 'test'])(
    '%s: the failure propagates (never "logged out" by accident)',
    async (env) => {
      vi.stubEnv('NODE_ENV', env);
      mocks.getCurrentUser.mockRejectedValue(new Error('database is down'));
      await expect(getOptionalUser()).rejects.toThrow('database is down');
      await expect(requireUser('/studio')).rejects.toThrow('database is down');
    },
  );

  it.each(['production', 'test'])(
    '%s: an unimplemented auth is an error too, with no preview user',
    async (env) => {
      vi.stubEnv('NODE_ENV', env);
      mocks.getCurrentUser.mockRejectedValue(new NotImplementedError('auth.getCurrentUser'));
      await expect(getAppUser()).rejects.toBeInstanceOf(NotImplementedError);
    },
  );

  it('development: a failure counts as "no user", is logged, and requireUser redirects', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mocks.getCurrentUser.mockRejectedValue(new Error('database is down'));
    await expect(getOptionalUser()).resolves.toBeNull();
    expect(mocks.warn).toHaveBeenCalledWith(
      'getCurrentUser failed',
      expect.objectContaining({ err: expect.any(Error) }),
    );
    await expect(getAppUser()).resolves.toBeNull();
    await expect(requireUser('/studio')).rejects.toThrow('NEXT_REDIRECT /login?next=%2Fstudio');
  });

  it('development, auth still a stub: the marketing side sees no user, the app side a preview user', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mocks.getCurrentUser.mockRejectedValue(new NotImplementedError('auth.getCurrentUser'));
    await expect(getOptionalUser()).resolves.toBeNull();
    await expect(getAppUser()).resolves.toEqual(PREVIEW_USER);
    await expect(requireUser('/studio')).resolves.toEqual(PREVIEW_USER);
    expect(mocks.warn).toHaveBeenCalledWith(
      'auth is not implemented yet; continuing without a user',
      expect.anything(),
    );
  });

  it('the preview user is plainly fake', () => {
    expect(PREVIEW_USER.email).toMatch(/\.local$/);
    expect(PREVIEW_USER.role).toBe('user');
  });
});
