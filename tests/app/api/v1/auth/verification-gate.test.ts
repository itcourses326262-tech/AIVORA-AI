import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { POST as confirm } from '@/app/api/v1/auth/verify-email/confirm/route';
import { GET as list, POST as create } from '@/app/api/v1/generations/route';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { freshDb } from '../../../../helpers/db';
import { invokeRoute } from '../../../../helpers/http';
import { cleanEmailState, linkIn, mailTo } from '../../../../server/email/support';
import { IMAGE_BODY, caller } from '../generations/support';
import { PASSWORD, browser, cookieNamed, routeTestState, stubEnv, type ErrorBody } from './support';

const harness = freshDb();
routeTestState();
// The bonus assertions in this file are about a setup where password accounts earn it
// (SIGNUP_BONUS_PROVIDER=any, the suite default); who earns it is google-only-bonus.test.ts.
beforeEach(() => stubEnv({ SIGNUP_BONUS_PROVIDER: 'any' }));
cleanEmailState();

type Body = { data: Record<string, unknown> } & ErrorBody;

function generate(headers: Record<string, string>, body: unknown = IMAGE_BODY) {
  return invokeRoute<Body>(create, { url: '/api/v1/generations', method: 'POST', headers, body });
}

describe('creating generations while the address is unconfirmed', () => {
  it('is allowed when confirmation is not required (the zero-config first run)', async () => {
    const dev = await caller(harness.db, { emailVerifiedAt: null });
    expect((await generate(dev.browser)).status).toBe(201);
    expect((await generate(dev.bearer)).status).toBe(201);
  });

  describe('when confirmation is required', () => {
    it.each([['browser session', 'browser'] as const, ['API key', 'bearer'] as const])(
      'is refused with 403 email_not_verified for a %s, and charges nothing',
      async (_label, kind) => {
        const dev = await caller(harness.db, { emailVerifiedAt: null });
        stubEnv({ EMAIL_VERIFICATION: 'required' });
        const result = await generate(dev[kind]);
        expect(result.status).toBe(403);
        expect(result.json.error.code).toBe('email_not_verified');
        expect(getBalance(harness.db, dev.userId)).toBe(50);
        expect(
          harness.db.select().from(generations).where(eq(generations.userId, dev.userId)).all(),
        ).toEqual([]);
      },
    );

    it('is refused before the body is even looked at', async () => {
      const dev = await caller(harness.db, { emailVerifiedAt: null });
      stubEnv({ EMAIL_VERIFICATION: 'required' });
      const result = await generate(dev.browser, { nonsense: true });
      expect(result.status).toBe(403);
      expect(result.json.error.code).toBe('email_not_verified');
    });

    it('still allows a confirmed account', async () => {
      const dev = await caller(harness.db, { emailVerifiedAt: Date.now() });
      stubEnv({ EMAIL_VERIFICATION: 'required' });
      expect((await generate(dev.browser)).status).toBe(201);
    });

    it('still lets the person look around: listing their generations is not gated', async () => {
      const dev = await caller(harness.db, { emailVerifiedAt: null });
      stubEnv({ EMAIL_VERIFICATION: 'required' });
      const result = await invokeRoute(list, { url: '/api/v1/generations', headers: dev.browser });
      expect(result.status).toBe(200);
    });

    it('follows the policy live: switching it off lets the same account in', async () => {
      const dev = await caller(harness.db, { emailVerifiedAt: null });
      stubEnv({ EMAIL_VERIFICATION: 'required' });
      expect((await generate(dev.browser)).status).toBe(403);
      stubEnv({ EMAIL_VERIFICATION: 'off' });
      expect((await generate(dev.browser)).status).toBe(201);
    });
  });
});

describe('the whole journey under mandatory confirmation', () => {
  it('register -> blocked -> confirm from the emailed link -> bonus -> generate', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const registered = await invokeRoute<Body>(register, {
      url: '/api/v1/auth/register',
      method: 'POST',
      headers: browser(),
      body: { email: 'layla@example.com', password: PASSWORD, name: 'Layla', locale: 'en' },
    });
    expect(registered.status).toBe(201);
    expect(registered.json.data).toMatchObject({ creditBalance: 0, role: 'user' });
    const cookie = `aivore_session=${cookieNamed(registered, 'aivore_session').value}`;
    const asLayla = browser(cookie);

    // Signed in, but cannot spend what she does not have yet.
    expect((await generate(asLayla)).json.error.code).toBe('email_not_verified');

    // The link in her inbox (no cookie needed: she may open it on her phone).
    const { token } = linkIn(await mailTo('layla@example.com'));
    const confirmed = await invokeRoute<Body>(confirm, {
      url: '/api/v1/auth/verify-email/confirm',
      method: 'POST',
      body: { token },
    });
    expect(confirmed.json.data).toMatchObject({ verified: true, bonusCredits: 50 });

    // Her existing session works as before, now able to generate with the bonus.
    const created = await generate(asLayla);
    expect(created.status).toBe(201);
    const userId = harness.db.select().from(generations).get()?.userId ?? '';
    expect(getBalance(harness.db, userId)).toBe(49);
  });
});
