import { describe, expect, it, vi } from 'vitest';
import type * as PasswordModule from '@/server/auth/password';
import { GET as account } from '@/app/api/v1/account/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { userSchema } from '@/lib/openapi/schemas';
import { createApiKey } from '@/server/auth/api-keys';
import { deleteAccount } from '@/server/auth/account-deletion';
import { registerUser } from '@/server/auth/users';
import { confirmEmailVerification } from '@/server/auth/verification';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { cleanEmailState, linkIn, mailTo } from '../../../../server/email/support';
import { expectUserDTO, routeTestState, stubEnv } from './support';

// Registering hashes the password; the real scrypt is not what this file is about.
const hashPassword = vi.hoisted(() => vi.fn(async () => 'scrypt$test-hash'));
vi.mock('@/server/auth/password', async (importOriginal) => ({
  ...(await importOriginal<typeof PasswordModule>()),
  hashPassword,
}));

const harness = freshDb();
routeTestState();
cleanEmailState();

const get = (cookie: string) =>
  invokeRoute<{ data: unknown }>(me, { url: '/api/v1/auth/me', headers: { cookie } });

describe('GET /api/v1/auth/me tells the UI where the account stands with email confirmation', () => {
  it('where no confirmation is asked for: not required, nothing pending, whatever the account has done', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'off' });
    const user = createUser(harness.db, { emailVerifiedAt: null });
    const result = await get(createSession(harness.db, user.id).cookie);
    expectUserDTO(result.json.data);
    expect(result.json.data).toMatchObject({
      emailVerified: false,
      emailVerificationRequired: false,
      pendingBonusCredits: 0,
    });
  });

  it('for a new account that has to confirm: unconfirmed, no credits yet, the bonus that confirming adds; then confirmed and paid', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser({
      email: 'layla@example.com',
      password: 'correct horse battery staple',
      name: 'Layla',
      locale: 'en',
    });
    const cookie = createSession(harness.db, user.id).cookie;

    const before = await get(cookie);
    expectUserDTO(before.json.data);
    expect(before.json.data).toMatchObject({
      creditBalance: 0,
      emailVerified: false,
      emailVerificationRequired: true,
      pendingBonusCredits: 50,
    });

    confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);

    const after = await get(cookie);
    expect(after.json.data).toMatchObject({
      creditBalance: 50,
      emailVerified: true,
      emailVerificationRequired: true,
      pendingBonusCredits: 0,
    });
  });

  it('promises no bonus to a mailbox that already had it (a deleted account registered again)', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const input = {
      email: 'layla@example.com',
      password: 'correct horse battery staple',
      name: 'Layla',
      locale: 'en' as const,
    };
    const first = await registerUser(input);
    confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    await deleteAccount(first.user.id);

    const second = await registerUser(input);
    const result = await get(createSession(harness.db, second.user.id).cookie);
    expect(result.json.data).toMatchObject({
      emailVerified: false,
      emailVerificationRequired: true,
      pendingBonusCredits: 0,
    });
  });

  it('is the same on GET /account, for a session and for an API key', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const user = createUser(harness.db, { emailVerifiedAt: 1_760_000_000_000, creditBalance: 7 });
    const session = createSession(harness.db, user.id);
    const key = await createApiKey(user.id, 'ci');
    const bySession = await invokeRoute<{ data: unknown }>(account, {
      url: '/api/v1/account',
      headers: { cookie: session.cookie },
    });
    const byKey = await invokeRoute<{ data: unknown }>(account, {
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${key.key}` },
    });
    for (const result of [bySession, byKey]) {
      expectUserDTO(result.json.data);
      expect(result.json.data).toMatchObject({
        emailVerified: true,
        emailVerificationRequired: true,
        pendingBonusCredits: 0,
      });
    }
  });

  it('is exactly what the OpenAPI document says a user is', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const user = createUser(harness.db, { emailVerifiedAt: null, creditBalance: 0 });
    const { data } = (await get(createSession(harness.db, user.id).cookie)).json;
    expect(userSchema.safeParse(data).success).toBe(true);
    // The document names the three fields, so an API client can read them too.
    expect(Object.keys(userSchema.shape)).toEqual(
      expect.arrayContaining(['emailVerified', 'emailVerificationRequired', 'pendingBonusCredits']),
    );
  });
});
