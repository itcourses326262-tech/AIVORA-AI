import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApiKey, resolveApiKey } from '@/server/auth/api-keys';
import { requestPasswordReset, resetPassword } from '@/server/auth/password-reset';
import { issueEmailToken } from '@/server/auth/email-tokens';
import { registerUser } from '@/server/auth/users';
import { apiKeys, type users } from '@/server/db/schema';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import {
  GOOD_PASSWORD,
  linkIn,
  mailTo,
  passwordFixture,
  stubEnv,
  trustTestState,
} from './trust-support';

const harness = freshDb();
const fixture = passwordFixture();
trustTestState();

const NEW_PASSWORD = 'a completely different passphrase 42';

function account(email: string, overrides: Partial<typeof users.$inferInsert> = {}) {
  return createUser(harness.db, {
    email,
    name: 'Layla',
    locale: 'en',
    passwordHash: fixture.hash,
    emailVerifiedAt: null,
    ...overrides,
  });
}

const revokedAt = (keyId: string) =>
  harness.db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get()?.revokedAt ?? null;

describe('a password reset evicts every credential, API keys included', () => {
  it('revokes every live key of the account, leaves old revocations and other accounts alone', async () => {
    const owner = account('layla@example.com');
    const bystander = account('someone@example.com');
    const first = await createApiKey(owner.id, 'planted');
    const second = await createApiKey(owner.id, 'ci');
    const retired = await createApiKey(owner.id, 'old');
    const theirs = await createApiKey(bystander.id, 'theirs');
    const retiredAt = Date.now() - 86_400_000;
    harness.db
      .update(apiKeys)
      .set({ revokedAt: retiredAt })
      .where(eq(apiKeys.id, retired.record.id))
      .run();

    const { secret } = issueEmailToken(harness.db, owner.id, 'reset');
    const now = Date.now();
    await resetPassword(secret, NEW_PASSWORD, now);

    expect(resolveApiKey(first.key, harness.db)).toBeNull();
    expect(resolveApiKey(second.key, harness.db)).toBeNull();
    expect(revokedAt(first.record.id)).toBe(now);
    expect(revokedAt(second.record.id)).toBe(now);
    // A key revoked earlier keeps its original date (the audit trail), someone else's is untouched.
    expect(revokedAt(retired.record.id)).toBe(retiredAt);
    expect(resolveApiKey(theirs.key, harness.db)?.user.id).toBe(bystander.id);
  });

  it('revokes nothing when the new password is refused (the link and the keys stay as they were)', async () => {
    const owner = account('layla@example.com');
    const { key } = await createApiKey(owner.id, 'ci');
    const { secret } = issueEmailToken(harness.db, owner.id, 'reset');
    await expect(resetPassword(secret, 'short')).rejects.toMatchObject({
      code: 'validation_failed',
    });
    expect(resolveApiKey(key, harness.db)?.user.id).toBe(owner.id);
  });

  it('a key planted by a pre-registration squatter does not survive the real owner recovering', async () => {
    // The squatter signs up with the owner's address while confirmation is switched off ...
    const squatter = await registerUser({
      email: 'layla@example.com',
      password: GOOD_PASSWORD,
      name: 'Not Layla',
      locale: 'en',
    });
    const { key: planted } = await createApiKey(squatter.user.id, 'backdoor');
    // ... confirmation becomes mandatory later, and the real owner recovers the address.
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    expect(requestPasswordReset('layla@example.com')).toBe(true);
    const { token } = linkIn(await mailTo('layla@example.com'));
    await resetPassword(token, NEW_PASSWORD);
    expect(resolveApiKey(planted, harness.db)).toBeNull();
  });

  it('tells the owner in the notice that the keys are gone (only when there were any)', async () => {
    const owner = account('layla@example.com');
    await createApiKey(owner.id, 'ci');
    await resetPassword(issueEmailToken(harness.db, owner.id, 'reset').secret, NEW_PASSWORD);
    const withKeys = await mailTo('layla@example.com');
    expect(withKeys).toMatchObject({ kind: 'password_changed' });
    expect(withKeys?.text).toMatch(/API keys were revoked/);

    const other = account('omar@example.com');
    await resetPassword(issueEmailToken(harness.db, other.id, 'reset').secret, NEW_PASSWORD);
    const withoutKeys = await mailTo('omar@example.com');
    expect(withoutKeys?.text).not.toMatch(/API keys/);
  });

  it('writes that sentence in Arabic for an Arabic account', async () => {
    const owner = account('layla@example.com', { locale: 'ar' });
    await createApiKey(owner.id, 'ci');
    await resetPassword(issueEmailToken(harness.db, owner.id, 'reset').secret, NEW_PASSWORD);
    const mail = await mailTo('layla@example.com');
    expect(mail?.html).toContain('dir="rtl"');
    expect(mail?.text).toMatch(/مفاتيح API/);
  });
});

describe('keys cannot be planted before the mailbox is proven', () => {
  it('refuses to create a key for an unconfirmed account when confirmation is required', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const squatter = account('layla@example.com');
    await expect(createApiKey(squatter.id, 'backdoor')).rejects.toMatchObject({
      code: 'email_not_verified',
      status: 403,
    });
    expect(harness.db.select().from(apiKeys).all()).toEqual([]);
  });

  it('allows it once the address is confirmed', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const owner = account('layla@example.com', { emailVerifiedAt: Date.now() });
    await expect(createApiKey(owner.id, 'ci')).resolves.toMatchObject({
      record: { name: 'ci' },
    });
  });

  it.each([
    ['off', 'off'],
    ['auto without SMTP', 'auto'],
  ])('does not apply when confirmation is not required (%s)', async (_label, policy) => {
    stubEnv({ EMAIL_VERIFICATION: policy });
    const user = account('layla@example.com');
    await expect(createApiKey(user.id, 'ci')).resolves.toBeDefined();
  });
});
