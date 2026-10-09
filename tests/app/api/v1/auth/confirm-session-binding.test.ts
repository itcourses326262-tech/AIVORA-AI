import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as confirmModule from '@/app/api/v1/auth/verify-email/confirm/route';
import { POST as createKey } from '@/app/api/v1/keys/route';
import { createApiKey } from '@/server/auth/api-keys';
import { issueEmailToken } from '@/server/auth/email-tokens';
import { apiKeys, users } from '@/server/db/schema';
import { cleanEmailState } from '../../../../server/email/support';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { browser, routeTestState, stubEnv, type ErrorBody } from './support';

const harness = freshDb();
routeTestState();
cleanEmailState();

const CONFIRM_URL = '/api/v1/auth/verify-email/confirm';

type Body = { data: Record<string, unknown> } & ErrorBody;

function confirm(token: string, headers: Record<string, string>) {
  return invokeRoute<Body>(confirmModule.POST, {
    url: CONFIRM_URL,
    method: 'POST',
    body: { token },
    headers,
  });
}

/** An unconfirmed administrator address whose owner is about to click the emailed link. */
function bossAccount() {
  stubEnv({ ADMIN_EMAILS: 'boss@example.com', EMAIL_VERIFICATION: 'required' });
  const user = createUser(harness.db, {
    email: 'boss@example.com',
    name: 'Boss',
    locale: 'en',
    creditBalance: 0,
    emailVerifiedAt: null,
  });
  const link = issueEmailToken(harness.db, user.id, 'verify').secret;
  return { user, link };
}

const roleOf = (userId: string) =>
  harness.db.select().from(users).where(eq(users.id, userId)).get()?.role;
const confirmedAt = (userId: string) =>
  harness.db.select().from(users).where(eq(users.id, userId)).get()?.emailVerifiedAt;

describe('POST /api/v1/auth/verify-email/confirm and the admin address', () => {
  it('a bare click (no cookie) confirms the address but promotes nobody', async () => {
    const { user, link } = bossAccount();
    const result = await confirm(link, {});
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({ verified: true, alreadyVerified: false });
    expect(confirmedAt(user.id)).not.toBeNull();
    expect(roleOf(user.id)).toBe('user');
  });

  it('the account holder confirming from its own browser session is promoted', async () => {
    const { user, link } = bossAccount();
    const session = createSession(harness.db, user.id);
    const result = await confirm(link, browser(session.cookie));
    expect(result.status).toBe(200);
    expect(roleOf(user.id)).toBe('admin');
  });

  it("somebody else's session is not proof: confirms, promotes neither account", async () => {
    const { user, link } = bossAccount();
    const stranger = createUser(harness.db, { email: 'stranger@example.com' });
    const session = createSession(harness.db, stranger.id);
    expect((await confirm(link, browser(session.cookie))).status).toBe(200);
    expect(confirmedAt(user.id)).not.toBeNull();
    expect(roleOf(user.id)).toBe('user');
    expect(roleOf(stranger.id)).toBe('user');
  });

  it('an API key of the account is not proof either (a key is not a browser holding the mailbox)', async () => {
    const { user, link } = bossAccount();
    // The key exists from before the address was gated (new keys are refused while unconfirmed).
    stubEnv({ EMAIL_VERIFICATION: 'off' });
    const { key } = await createApiKey(user.id, 'ci');
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const result = await confirm(link, { authorization: `Bearer ${key}` });
    expect(result.status).toBe(200);
    expect(roleOf(user.id)).toBe('user');
  });

  it('a stale or garbage cookie just makes the caller anonymous, it does not break the link', async () => {
    const { user, link } = bossAccount();
    const result = await confirm(link, browser('aivore_session=not-a-session'));
    expect(result.status).toBe(200);
    expect(confirmedAt(user.id)).not.toBeNull();
    expect(roleOf(user.id)).toBe('user');
  });
});

describe('POST /api/v1/keys while the address is unconfirmed', () => {
  function create(headers: Record<string, string>) {
    return invokeRoute<Body>(createKey, {
      url: '/api/v1/keys',
      method: 'POST',
      headers,
      body: { name: 'backdoor' },
    });
  }

  it('is refused with 403 email_not_verified when confirmation is required, and stores nothing', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const squatter = createUser(harness.db, { email: 'victim@example.com', emailVerifiedAt: null });
    const session = createSession(harness.db, squatter.id);
    const result = await create(session.headers);
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('email_not_verified');
    expect(harness.db.select().from(apiKeys).all()).toEqual([]);
  });

  it('works for a confirmed account, and for anybody when confirmation is not required', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const confirmed = createUser(harness.db, { emailVerifiedAt: Date.now() });
    expect((await create(createSession(harness.db, confirmed.id).headers)).status).toBe(201);
    stubEnv({ EMAIL_VERIFICATION: 'off' });
    const unconfirmed = createUser(harness.db, { emailVerifiedAt: null });
    expect((await create(createSession(harness.db, unconfirmed.id).headers)).status).toBe(201);
  });
});
