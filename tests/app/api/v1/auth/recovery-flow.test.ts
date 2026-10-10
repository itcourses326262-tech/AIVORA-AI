import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LoggerModule from '@/server/logger';
import { DELETE as deleteAccount } from '@/app/api/v1/account/route';
import { GET as exportData } from '@/app/api/v1/account/export/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as forgot } from '@/app/api/v1/auth/password/forgot/route';
import { POST as reset } from '@/app/api/v1/auth/password/reset/route';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { POST as confirm } from '@/app/api/v1/auth/verify-email/confirm/route';
import { POST as requestLink } from '@/app/api/v1/auth/verify-email/request/route';
import { flushBackground } from '@/server/auth/background';
import { setEmailTransportOverride, flushEmails } from '@/server/email';
import { outboxTransport } from '@/server/email/outbox';
import { freshDb } from '../../../../helpers/db';
import { invokeRoute } from '../../../../helpers/http';
import { cleanEmailState, linkIn, mailTo } from '../../../../server/email/support';
import { browser, cookieNamed, routeTestState, stubEnv, type ErrorBody } from './support';

// Everything the server logs during the journey, as the logger receives it (before redaction).
const lines = vi.hoisted(() => [] as unknown[][]);
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      lines.push([level, ...args]);
    };
  const logger = {
    level: 'debug',
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  };
  return { ...original, getLogger: () => logger };
});

freshDb();
routeTestState();
// The bonus assertions in this file are about a setup where password accounts earn it
// (SIGNUP_BONUS_PROVIDER=any, the suite default); who earns it is google-only-bonus.test.ts.
beforeEach(() => stubEnv({ SIGNUP_BONUS_PROVIDER: 'any' }));
cleanEmailState();

type Body = { data: Record<string, unknown> } & ErrorBody;

const FIRST_PASSWORD = 'correct horse battery staple';
const SECOND_PASSWORD = 'a completely different passphrase 42';
const SMTP_PASSWORD = 's3cr3t-smtp-pass-9f2c';

describe('the whole account journey, end to end', () => {
  it('register -> confirm -> forget -> reset -> export -> delete, with no secret ever logged', async () => {
    stubEnv({
      EMAIL_VERIFICATION: 'required',
      SMTP_URL: `smtp://mailer:${SMTP_PASSWORD}@smtp.example.com:587`,
      EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
      TRUST_PROXY: 'true',
    });
    // A relay that accepts everything: the mail lands in the outbox where the test can read it.
    setEmailTransportOverride({ name: 'smtp', send: (message) => outboxTransport.send(message) });
    const from = (n: number) => ({ 'x-forwarded-for': `198.51.100.${n}` });
    const secrets: string[] = [FIRST_PASSWORD, SECOND_PASSWORD, SMTP_PASSWORD];

    // 1. Sign up. The account starts without credits; a link goes to the inbox.
    const registered = await invokeRoute<Body>(register, {
      url: '/api/v1/auth/register',
      method: 'POST',
      headers: browser(undefined, from(1)),
      body: { email: 'layla@example.com', password: FIRST_PASSWORD, name: 'Layla', locale: 'ar' },
    });
    expect(registered.status).toBe(201);
    expect(registered.json.data.creditBalance).toBe(0);
    const session = cookieNamed(registered, 'aivore_session').value;
    secrets.push(session);
    const signedIn = browser(`aivore_session=${session}`, from(1));

    const verifyMail = await mailTo('layla@example.com');
    expect(verifyMail?.kind).toBe('verification');
    expect(verifyMail?.html).toContain('dir="rtl"');
    const verifyToken = linkIn(verifyMail).token;
    secrets.push(verifyToken);

    // 2. Ask for another link (the 60 second gap applies), then use the first one from a phone.
    const tooSoon = await invokeRoute<Body>(requestLink, {
      url: '/api/v1/auth/verify-email/request',
      method: 'POST',
      headers: signedIn,
    });
    expect(tooSoon.status).toBe(429);
    const confirmed = await invokeRoute<Body>(confirm, {
      url: '/api/v1/auth/verify-email/confirm',
      method: 'POST',
      headers: from(2),
      body: { token: verifyToken },
    });
    expect(confirmed.json.data).toEqual({
      verified: true,
      alreadyVerified: false,
      bonusCredits: 50,
    });
    const whoami = await invokeRoute<{ data: { creditBalance: number } }>(me, {
      url: '/api/v1/auth/me',
      headers: signedIn,
    });
    expect(whoami.json.data.creditBalance).toBe(50);

    // 3. Forgets the password, resets it from the emailed link.
    const asked = await invokeRoute<Body>(forgot, {
      url: '/api/v1/auth/password/forgot',
      method: 'POST',
      headers: browser(undefined, from(3)),
      body: { email: 'layla@example.com' },
    });
    expect(asked.status).toBe(202);
    await flushBackground();
    const resetMail = await mailTo('layla@example.com');
    expect(resetMail?.kind).toBe('password_reset');
    const resetToken = linkIn(resetMail).token;
    secrets.push(resetToken);
    const changed = await invokeRoute(reset, {
      url: '/api/v1/auth/password/reset',
      method: 'POST',
      headers: browser(undefined, from(4)),
      body: { token: resetToken, password: SECOND_PASSWORD },
    });
    expect(changed.status).toBe(204);
    expect((await mailTo('layla@example.com'))?.kind).toBe('password_changed');

    // Every device was signed out; the new password (not the old) signs in.
    const stale = await invokeRoute<{ data: unknown }>(me, {
      url: '/api/v1/auth/me',
      headers: signedIn,
    });
    expect(stale.json.data).toBeNull();
    const oldLogin = await invokeRoute<Body>(login, {
      url: '/api/v1/auth/login',
      method: 'POST',
      headers: browser(undefined, from(5)),
      body: { email: 'layla@example.com', password: FIRST_PASSWORD },
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await invokeRoute<Body>(login, {
      url: '/api/v1/auth/login',
      method: 'POST',
      headers: browser(undefined, from(6)),
      body: { email: 'layla@example.com', password: SECOND_PASSWORD },
    });
    expect(newLogin.status).toBe(200);
    const fresh = browser(
      `aivore_session=${cookieNamed(newLogin, 'aivore_session').value}`,
      from(6),
    );
    secrets.push(cookieNamed(newLogin, 'aivore_session').value);

    // 4. Takes the data, then deletes the account.
    const exported = await invokeRoute(exportData, {
      url: '/api/v1/account/export',
      headers: fresh,
    });
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('layla@example.com');
    const deleted = await invokeRoute(deleteAccount, {
      url: '/api/v1/account',
      method: 'DELETE',
      headers: fresh,
      body: { password: SECOND_PASSWORD },
    });
    expect(deleted.status).toBe(204);
    expect((await mailTo('layla@example.com'))?.kind).toBe('account_deleted');
    const gone = await invokeRoute<{ data: unknown }>(me, {
      url: '/api/v1/auth/me',
      headers: fresh,
    });
    expect(gone.json.data).toBeNull();

    // Nothing secret reached a log line: no password, token, session cookie or SMTP credential.
    await flushEmails();
    const everything = JSON.stringify(lines);
    for (const secret of secrets) {
      expect(everything, `log contains ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
    expect(everything).not.toContain('scrypt$');
    // Addresses appear only masked.
    expect(everything).not.toContain('layla@example.com');
  });
});
