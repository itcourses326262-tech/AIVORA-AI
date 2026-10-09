import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as exportRoute } from '@/app/api/v1/account/export/route';
import { createApiKey } from '@/server/auth/api-keys';
import { debitCredits, grantCredits } from '@/server/credits';
import { newId } from '@/lib/id';
import { creditLedger, orders, subscriptions, users } from '@/server/db/schema';
import { freshDb } from '../../../../helpers/db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
} from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { routeTestState, type ErrorBody } from '../auth/support';

const harness = freshDb();
routeTestState();

const URL_ = '/api/v1/account/export';

interface Export {
  format: string;
  exportedAt: number;
  profile: Record<string, unknown>;
  sessions: Array<Record<string, unknown>>;
  apiKeys: Array<Record<string, unknown>>;
  ledger: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  generations: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
}

function download(headers: Record<string, string>, extra: { query?: Record<string, string> } = {}) {
  return invokeRoute<Export & ErrorBody>(exportRoute, { url: URL_, headers, query: extra.query });
}

async function populate(email: string, prompt: string) {
  const db = harness.db;
  const user = createUser(db, {
    email,
    name: `Name of ${email}`,
    locale: 'ar',
    creditBalance: 0,
    signupIp: '203.0.113.9',
    emailVerifiedAt: 1_700_000_000_000,
  });
  const session = createSession(db, user.id, { userAgent: 'Vitest Browser', ip: '203.0.113.9' });
  const { key } = await createApiKey(user.id, 'ci key');
  grantCredits(db, { userId: user.id, amount: 100, reason: 'signup_bonus', note: 'welcome' });
  const input = createAsset(db, { userId: user.id, role: 'input' });
  const generation = createGeneration(db, {
    userId: user.id,
    status: 'succeeded',
    prompt,
    negativePrompt: 'blurry',
    cost: 4,
    inputAssetId: input.id,
    providerJobId: 'upstream-secret-job-id',
    providerMeta: { internal: 'meta' },
    workerId: 'worker-1',
    idempotencyKey: 'idem-secret',
    isPublic: true,
  });
  debitCredits(db, { userId: user.id, amount: 4, generationId: generation.id });
  const output = createAsset(db, {
    userId: user.id,
    role: 'output',
    generationId: generation.id,
    thumbKey: `u/${user.id}/${generation.id}/thumb.webp`,
  });
  return { user, session, key, input, generation, output };
}

describe('GET /api/v1/account/export', () => {
  it('needs a login, and a browser session at that', async () => {
    expect((await download({})).status).toBe(401);
    const a = await populate('layla@example.com', 'a lighthouse');
    const viaKey = await download({ authorization: `Bearer ${a.key}` });
    expect(viaKey.status).toBe(403);
    expect(viaKey.json.error.code).toBe('forbidden');
  });

  it('is a JSON download with everything the person owns', async () => {
    const a = await populate('layla@example.com', 'منارة عند الفجر');
    const result = await download(a.session.headers);

    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(result.headers.get('content-disposition')).toMatch(
      /^attachment; filename="aivore-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('cache-control')).toBe('no-store');

    const data = result.json;
    expect(data.format).toBe('aivore-account-export/1');
    expect(data.exportedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(data.profile).toMatchObject({
      id: a.user.id,
      email: 'layla@example.com',
      name: 'Name of layla@example.com',
      role: 'user',
      locale: 'ar',
      creditBalance: 96,
      emailVerifiedAt: 1_700_000_000_000,
      signupIp: '203.0.113.9',
    });
    expect(data.sessions).toMatchObject([
      { id: a.session.id, userAgent: 'Vitest Browser', ip: '203.0.113.9' },
    ]);
    expect(data.apiKeys).toMatchObject([
      { name: 'ci key', prefix: expect.stringMatching(/^avk_/), revokedAt: null },
    ]);
    expect(data.ledger.map((entry) => entry.reason)).toEqual(['signup_bonus', 'generation']);
    expect(data.ledger[0]).toMatchObject({ delta: 100, balanceAfter: 100, note: 'welcome' });
    expect(data.generations).toMatchObject([
      {
        id: a.generation.id,
        prompt: 'منارة عند الفجر',
        negativePrompt: 'blurry',
        status: 'succeeded',
        cost: 4,
        isPublic: true,
        inputAssetId: a.input.id,
        params: { aspectRatio: '1:1', count: 1 },
      },
    ]);
    const assetIds = data.assets.map((asset) => asset.id);
    expect(assetIds).toEqual([a.input.id, a.output.id].sort());
    const output = data.assets.find((asset) => asset.id === a.output.id);
    expect(output).toMatchObject({
      role: 'output',
      generationId: a.generation.id,
      url: `http://localhost:3000/api/v1/media/${a.output.id}`,
      thumbUrl: `http://localhost:3000/api/v1/media/${a.output.id}?variant=thumb`,
    });
    // An asset without a thumbnail does not pretend to have one.
    expect(data.assets.find((asset) => asset.id === a.input.id)).not.toHaveProperty('thumbUrl');
  });

  it('never contains a secret, a hash or an internal detail', async () => {
    const a = await populate('layla@example.com', 'a lighthouse');
    const { text } = await download(a.session.headers);
    for (const secret of [
      a.key,
      a.session.token,
      a.user.passwordHash,
      'upstream-secret-job-id',
      'worker-1',
      'idem-secret',
      a.output.storageKey,
      'passwordHash',
      'tokenHash',
      'keyHash',
      'providerMeta',
      'storageKey',
      'idempotencyKey',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  describe('purchases', () => {
    function purchase(userId: string, suffix: string) {
      const subscriptionId = newId('sub');
      harness.db
        .insert(subscriptions)
        .values({
          id: subscriptionId,
          userId,
          planId: 'starter',
          status: 'active',
          anchorDay: 14,
          currentPeriodStart: 1_700_000_000_000,
          currentPeriodEnd: 1_702_592_000_000,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        })
        .run();
      const base = {
        userId,
        currency: 'SAR' as const,
        gateway: 'moyasar' as const,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      };
      const paid = newId('ord');
      const open = newId('ord');
      harness.db
        .insert(orders)
        .values([
          {
            ...base,
            id: paid,
            kind: 'pack',
            itemId: 'pack-500',
            amountHalalas: 2900,
            vatHalalas: 378,
            credits: 500,
            status: 'paid',
            paidAt: 1_700_000_100_000,
            refundedHalalas: 1450,
            gatewayInvoiceId: `inv-secret-${suffix}`,
            gatewayPaymentId: `pay-secret-${suffix}`,
            idempotencyKey: `order-idem-secret-${suffix}`,
          },
          {
            ...base,
            id: open,
            kind: 'subscription_initial',
            itemId: 'starter',
            amountHalalas: 4900,
            vatHalalas: 639,
            credits: 1000,
            status: 'pending',
            subscriptionId,
            expiresAt: Date.now() + 3_600_000,
            checkoutUrl: `https://pay.example.com/secret-page-${suffix}`,
            gatewayInvoiceId: `inv-open-${suffix}`,
          },
        ])
        .run();
      return { subscriptionId, paid, open };
    }

    it('lists what was bought and how it ended, never a payment page or a gateway id', async () => {
      const a = await populate('layla@example.com', 'a lighthouse');
      const mine = purchase(a.user.id, 'layla');
      const result = await download(a.session.headers);

      expect(result.json.orders).toHaveLength(2);
      expect(result.json.orders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: mine.paid,
            kind: 'pack',
            itemId: 'pack-500',
            amountHalalas: 2900,
            vatHalalas: 378,
            currency: 'SAR',
            credits: 500,
            status: 'paid',
            refundedHalalas: 1450,
            paidAt: 1_700_000_100_000,
          }),
          expect.objectContaining({
            id: mine.open,
            status: 'pending',
            subscriptionId: mine.subscriptionId,
          }),
        ]),
      );
      expect(result.json.subscriptions).toMatchObject([
        { id: mine.subscriptionId, planId: 'starter', status: 'active', cancelAtPeriodEnd: false },
      ]);
      for (const secret of [
        'inv-secret',
        'pay-secret',
        'inv-open',
        'order-idem-secret',
        'secret-page',
        'checkoutUrl',
        'gatewayInvoiceId',
        'gatewayPaymentId',
      ]) {
        expect(result.text, secret).not.toContain(secret);
      }
    });

    it("contains nobody else's purchases", async () => {
      const a = await populate('layla@example.com', 'x');
      const b = await populate('omar@example.com', 'x');
      purchase(a.user.id, 'layla');
      const theirs = purchase(b.user.id, 'omar');
      const result = await download(a.session.headers);
      expect(result.text).not.toContain(theirs.paid);
      expect(result.text).not.toContain(theirs.open);
      expect(result.text).not.toContain(theirs.subscriptionId);
    });
  });

  describe('isolation (IDOR)', () => {
    it("contains nothing of anybody else's, whoever asks", async () => {
      const a = await populate('layla@example.com', 'secret prompt of layla');
      const b = await populate('omar@example.com', 'secret prompt of omar');

      const forA = (await download(a.session.headers)).text;
      const forB = (await download(b.session.headers)).text;

      for (const leak of [
        b.user.id,
        'omar@example.com',
        'secret prompt of omar',
        b.generation.id,
        b.output.id,
        b.session.id,
      ]) {
        expect(forA, leak).not.toContain(leak);
      }
      for (const leak of [
        a.user.id,
        'layla@example.com',
        'secret prompt of layla',
        a.generation.id,
        a.output.id,
        a.session.id,
      ]) {
        expect(forB, leak).not.toContain(leak);
      }
    });

    it('takes the account from the session only: ids in the query, headers or cookies change nothing', async () => {
      const a = await populate('layla@example.com', 'secret prompt of layla');
      const b = await populate('omar@example.com', 'secret prompt of omar');
      const result = await download(
        { ...a.session.headers, 'x-user-id': b.user.id, 'x-forwarded-user': b.user.id },
        { query: { userId: b.user.id, id: b.user.id, email: 'omar@example.com' } },
      );
      expect(result.status).toBe(200);
      expect(result.json.profile.id).toBe(a.user.id);
      expect(result.text).not.toContain('omar');
    });

    it('lists every ledger row exactly once across page boundaries', async () => {
      const a = await populate('layla@example.com', 'x');
      const base = Date.now();
      harness.db
        .insert(creditLedger)
        .values(
          Array.from({ length: 1203 }, (_, index) => ({
            id: `led_bulk${String(index).padStart(6, '0')}`,
            userId: a.user.id,
            delta: 1,
            balanceAfter: 97 + index,
            reason: 'adjustment' as const,
            createdAt: base + index,
          })),
        )
        .run();
      const result = await download(a.session.headers);
      const ids = result.json.ledger.map((entry) => entry.id as string);
      expect(ids).toHaveLength(1205);
      expect(new Set(ids).size).toBe(1205);
      expect(ids).toEqual([...ids].sort());
    });
  });

  it('is valid JSON when there is nothing to list', async () => {
    const user = createUser(harness.db, { creditBalance: 0 });
    const session = createSession(harness.db, user.id);
    const result = await download(session.headers);
    expect(result.json).toMatchObject({
      profile: { id: user.id },
      sessions: [{ id: session.id }],
      apiKeys: [],
      ledger: [],
      orders: [],
      subscriptions: [],
      generations: [],
      assets: [],
    });
  });

  it('is limited to 3 a day per account, each account on its own', async () => {
    const a = await populate('layla@example.com', 'x');
    const b = await populate('omar@example.com', 'x');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await download(a.session.headers)).status).toBe(200);
    }
    const blocked = await download(a.session.headers);
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(80_000);
    expect((await download(b.session.headers)).status).toBe(200);
  });

  it('refuses a page on another site that tries to spend the three downloads', async () => {
    const a = await populate('layla@example.com', 'x');
    const hostile = await download({ ...a.session.headers, 'sec-fetch-site': 'cross-site' });
    expect(hostile.status).toBe(403);
    expect((await download({ ...a.session.headers, 'sec-fetch-site': 'same-origin' })).status).toBe(
      200,
    );
  });

  it('does not export a disabled account that can no longer sign in', async () => {
    const a = await populate('layla@example.com', 'x');
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, a.user.id)).run();
    expect((await download(a.session.headers)).status).toBe(401);
  });
});
