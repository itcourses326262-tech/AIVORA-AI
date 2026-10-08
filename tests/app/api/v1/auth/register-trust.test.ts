import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { creditLedger, emailTokens, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { freshDb } from '../../../../helpers/db';
import { invokeRoute } from '../../../../helpers/http';
import { cleanEmailState, linkIn, mailTo } from '../../../../server/email/support';
import { PASSWORD, browser, routeTestState, setCookies, stubEnv, type ErrorBody } from './support';

const harness = freshDb();
routeTestState();
cleanEmailState();

type Body = { data: Record<string, unknown> } & ErrorBody;

function signUp(email: string, headers: Record<string, string> = browser()) {
  return invokeRoute<Body>(register, {
    url: '/api/v1/auth/register',
    method: 'POST',
    headers,
    body: { email, password: PASSWORD, name: 'Lina', locale: 'en' },
  });
}

describe('POST /api/v1/auth/register: sign-up abuse and confirmation', () => {
  it('refuses a throwaway-mail domain with 422 email_not_allowed, no cookie and no account', async () => {
    const result = await signUp('someone@mailinator.com');
    expect(result.status).toBe(422);
    expect(result.json.error.code).toBe('email_not_allowed');
    expect(setCookies(result)).toEqual([]);
    expect(harness.db.select().from(users).all()).toEqual([]);
  });

  it('answers an alias of a taken mailbox exactly like a plain duplicate: 409, same body', async () => {
    await signUp('ab@gmail.com');
    const plain = await signUp('ab@gmail.com');
    const alias = await signUp('a.b+deal@gmail.com');
    expect(plain.status).toBe(409);
    expect(alias.status).toBe(409);
    expect(alias.json).toEqual(plain.json);
    expect(alias.text).toBe(plain.text);
    expect(setCookies(alias)).toEqual([]);
  });

  it('stops a client address that signed up too often today: 429 signup_limit', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '2', TRUST_PROXY: 'true' });
    const from = (address: string) => browser(undefined, { 'x-forwarded-for': address });
    expect((await signUp('a@example.com', from('203.0.113.50'))).status).toBe(201);
    expect((await signUp('b@example.com', from('203.0.113.50'))).status).toBe(201);
    const blocked = await signUp('c@example.com', from('203.0.113.50'));
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('signup_limit');
    expect(setCookies(blocked)).toEqual([]);
    expect((await signUp('d@example.com', from('203.0.113.51'))).status).toBe(201);
  });

  it('under mandatory confirmation: 201 without credits, a link by email, no secret in the response', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const result = await signUp('lina@example.com');
    expect(result.status).toBe(201);
    expect(result.json.data).toMatchObject({
      email: 'lina@example.com',
      creditBalance: 0,
      role: 'user',
    });

    const mail = await mailTo('lina@example.com');
    const { token } = linkIn(mail);
    expect(result.text).not.toContain(token);
    expect(JSON.stringify(setCookies(result))).not.toContain(token);
    expect(harness.db.select().from(creditLedger).all()).toEqual([]);
    const user = harness.db.select().from(users).get();
    expect(
      harness.db
        .select()
        .from(emailTokens)
        .where(eq(emailTokens.userId, user?.id ?? ''))
        .all(),
    ).toHaveLength(1);
  });

  it('does not wait for the email: the response is the account, whatever the relay does', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { setEmailTransportOverride } = await import('@/server/email');
    setEmailTransportOverride({
      name: 'smtp',
      send: () => new Promise<void>(() => {}),
    });
    const result = await signUp('lina@example.com');
    expect(result.status).toBe(201);
    expect(getOutbox()).toEqual([]);
    setEmailTransportOverride(null);
  });
});
