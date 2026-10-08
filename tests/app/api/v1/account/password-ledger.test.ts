import { beforeAll, describe, expect, it } from 'vitest';
import { POST as changePassword } from '@/app/api/v1/account/password/route';
import { GET as ledger } from '@/app/api/v1/account/ledger/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { createApiKey } from '@/server/auth/api-keys';
import { hashPassword } from '@/server/auth/password';
import { debitCredits, grantCredits } from '@/server/credits';
import type { LedgerEntryDTO, Page } from '@/lib/api-types';
import { freshDb } from '../../../../helpers/db';
import { createGeneration, createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { PASSWORD, browser, stubEnv, useRouteTestState, type ErrorBody } from '../auth/support';

const harness = freshDb();
useRouteTestState();

let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

const NEW_PASSWORD = 'a completely new passphrase 7';

function change(body: unknown, headers: Record<string, string>) {
  return invokeRoute<ErrorBody>(changePassword, {
    url: '/api/v1/account/password',
    method: 'POST',
    body,
    headers,
  });
}

function whoami(cookie: string) {
  return invokeRoute<{ data: { id: string } | null }>(me, {
    url: '/api/v1/auth/me',
    headers: { cookie },
  });
}

describe('POST /api/v1/account/password', () => {
  it('changes the password: 204, the caller stays signed in, other sessions end, old password dies', async () => {
    const user = createUser(harness.db, { passwordHash, email: 'pw@example.com' });
    const own = createSession(harness.db, user.id);
    const phone = createSession(harness.db, user.id);

    const result = await change(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      own.headers,
    );
    expect(result.status).toBe(204);
    expect(result.text).toBe('');

    expect((await whoami(own.cookie)).json.data?.id).toBe(user.id);
    expect((await whoami(phone.cookie)).json.data).toBeNull();

    const attempt = (password: string) =>
      invokeRoute(login, {
        url: '/api/v1/auth/login',
        method: 'POST',
        body: { email: 'pw@example.com', password },
        headers: browser(),
      });
    expect((await attempt(PASSWORD)).status).toBe(401);
    expect((await attempt(NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects a wrong current password with a field error, not a sign-out', async () => {
    const user = createUser(harness.db, { passwordHash });
    const own = createSession(harness.db, user.id);
    const result = await change(
      { currentPassword: 'definitely-wrong-1', newPassword: NEW_PASSWORD },
      own.headers,
    );
    expect(result.status).toBe(422);
    expect(result.json.error.code).toBe('validation_failed');
    expect(result.json.error.details).toMatchObject({ issues: [{ path: 'currentPassword' }] });
    expect((await whoami(own.cookie)).json.data?.id).toBe(user.id);
  });

  it('applies the password policy to the new password', async () => {
    const user = createUser(harness.db, { passwordHash });
    const own = createSession(harness.db, user.id);
    for (const newPassword of ['short', 'password123', PASSWORD]) {
      const result = await change({ currentPassword: PASSWORD, newPassword }, own.headers);
      expect(result.status, newPassword).toBe(422);
    }
    expect((await change({ currentPassword: PASSWORD }, own.headers)).status).toBe(422);
    expect((await change({}, own.headers)).status).toBe(422);
  });

  it('is for browser sessions only: an API key gets 403, a stranger 401', async () => {
    const user = createUser(harness.db, { passwordHash });
    const { key } = await createApiKey(user.id, 'ci');
    const viaKey = await change(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { authorization: `Bearer ${key}` },
    );
    expect(viaKey.status).toBe(403);
    expect(viaKey.json.error.code).toBe('forbidden');
    expect(
      (await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, browser())).status,
    ).toBe(401);
  });

  it('is CSRF protected', async () => {
    const user = createUser(harness.db, { passwordHash });
    const own = createSession(harness.db, user.id);
    const result = await change(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: own.cookie, origin: 'https://evil.example' },
    );
    expect(result.status).toBe(403);
  });

  it('allows 5 guesses a minute per user and then 429, so the current password cannot be ground down', async () => {
    const user = createUser(harness.db, { passwordHash });
    const own = createSession(harness.db, user.id);
    for (let index = 0; index < 5; index += 1) {
      expect(
        (await change({ currentPassword: 'wrong-wrong-1', newPassword: NEW_PASSWORD }, own.headers))
          .status,
      ).toBe(422);
    }
    const blocked = await change(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      own.headers,
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Not for other users.
    const other = createUser(harness.db, { passwordHash });
    const otherSession = createSession(harness.db, other.id);
    expect(
      (await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, otherSession.headers))
        .status,
    ).toBe(204);
  });

  it('is unthrottled when RATE_LIMIT_DISABLED=true', async () => {
    stubEnv({ RATE_LIMIT_DISABLED: 'true' });
    const user = createUser(harness.db, { passwordHash });
    const own = createSession(harness.db, user.id);
    for (let index = 0; index < 8; index += 1) {
      expect(
        (await change({ currentPassword: 'wrong-wrong-1', newPassword: NEW_PASSWORD }, own.headers))
          .status,
      ).toBe(422);
    }
  });
});

describe('GET /api/v1/account/ledger', () => {
  function list(headers: Record<string, string>, query: Record<string, string | number> = {}) {
    return invokeRoute<Page<LedgerEntryDTO> & ErrorBody>(ledger, {
      url: '/api/v1/account/ledger',
      headers,
      query,
    });
  }

  function seedLedger(userId: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      grantCredits(harness.db, {
        userId,
        amount: index + 1,
        reason: 'admin_grant',
        note: `grant ${index + 1}`,
      });
    }
  }

  it('lists the credit history newest first with DTO fields only', async () => {
    const user = createUser(harness.db, { creditBalance: 0 });
    seedLedger(user.id, 3);
    const generation = createGeneration(harness.db, { userId: user.id });
    debitCredits(harness.db, { userId: user.id, amount: 2, generationId: generation.id });
    const session = createSession(harness.db, user.id);

    const result = await list({ cookie: session.cookie });
    expect(result.status).toBe(200);
    expect(result.json.nextCursor).toBeNull();
    expect(result.json.data.map((entry) => entry.reason)).toEqual([
      'generation',
      'admin_grant',
      'admin_grant',
      'admin_grant',
    ]);
    expect(result.json.data[0]).toMatchObject({
      delta: -2,
      balanceAfter: 4,
      generationId: generation.id,
    });
    expect(Object.keys(result.json.data[1] ?? {}).sort()).toEqual([
      'balanceAfter',
      'createdAt',
      'delta',
      'id',
      'note',
      'reason',
    ]);
    expect(result.text).not.toMatch(/userId|idempotency/);
  });

  it('paginates with an opaque cursor', async () => {
    const user = createUser(harness.db, { creditBalance: 0 });
    seedLedger(user.id, 5);
    const session = createSession(harness.db, user.id);

    const first = await list({ cookie: session.cookie }, { limit: 2 });
    expect(first.json.data).toHaveLength(2);
    expect(first.json.nextCursor).toEqual(expect.any(String));
    const second = await list(
      { cookie: session.cookie },
      { limit: 2, cursor: first.json.nextCursor ?? '' },
    );
    const third = await list(
      { cookie: session.cookie },
      { limit: 2, cursor: second.json.nextCursor ?? '' },
    );
    expect(third.json.nextCursor).toBeNull();
    const notes = [...first.json.data, ...second.json.data, ...third.json.data].map(
      (entry) => entry.note,
    );
    expect(notes).toEqual(['grant 5', 'grant 4', 'grant 3', 'grant 2', 'grant 1']);
  });

  it('shows only the caller own entries (a cursor from another account leaks nothing)', async () => {
    const mine = createUser(harness.db, { creditBalance: 0 });
    const theirs = createUser(harness.db, { creditBalance: 0 });
    seedLedger(mine.id, 1);
    seedLedger(theirs.id, 4);
    const session = createSession(harness.db, mine.id);
    const theirSession = createSession(harness.db, theirs.id);

    const own = await list({ cookie: session.cookie });
    expect(own.json.data).toHaveLength(1);
    const theirPage = await list({ cookie: theirSession.cookie }, { limit: 1 });
    const crossed = await list(
      { cookie: session.cookie },
      { cursor: theirPage.json.nextCursor ?? '' },
    );
    expect(crossed.json.data.every((entry) => entry.note === 'grant 1')).toBe(true);
  });

  it('validates limit and cursor', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    for (const query of [{ limit: 0 }, { limit: 101 }, { limit: 'abc' }, { limit: -1 }]) {
      expect((await list({ cookie: session.cookie }, query)).status, JSON.stringify(query)).toBe(
        422,
      );
    }
    const bad = await list({ cookie: session.cookie }, { cursor: 'not-a-cursor' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('bad_request');
  });

  it('works with an API key and is 401 anonymously', async () => {
    const user = createUser(harness.db, { creditBalance: 0 });
    seedLedger(user.id, 1);
    const { key } = await createApiKey(user.id, 'ci');
    expect((await list({ authorization: `Bearer ${key}` })).json.data).toHaveLength(1);
    expect((await list({})).status).toBe(401);
  });
});
