import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAppError, type AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import {
  MAX_CREDIT_AMOUNT,
  debitCredits,
  getBalance,
  grantCredits,
  listLedger,
  refundGeneration,
  toLedgerEntryDTO,
} from '@/server/credits';
import { withTx, type Db } from '@/server/db';
import { creditLedger, users } from '@/server/db/schema';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

let test: TestDb;
let db: Db;

beforeEach(() => {
  test = createTestDb();
  db = test.db;
});

afterEach(() => {
  vi.restoreAllMocks();
  test.close();
});

const ledgerCount = () => db.select().from(creditLedger).all().length;

function thrown(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('expected the action to throw an AppError');
}

describe('getBalance', () => {
  it('returns the cached balance', () => {
    const user = seedUser(db, { creditBalance: 42 });
    expect(getBalance(db, user.id)).toBe(42);
  });

  it('throws not_found for an unknown user', () => {
    expect(thrown(() => getBalance(db, 'usr_missing'))).toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });
});

describe('grantCredits', () => {
  it('adds credits and records a ledger entry with the resulting balance', () => {
    const user = seedUser(db, { creditBalance: 0 });
    const entry = grantCredits(db, {
      userId: user.id,
      amount: 50,
      reason: 'signup_bonus',
      note: 'Welcome',
    });
    expect(entry).toMatchObject({
      userId: user.id,
      delta: 50,
      balanceAfter: 50,
      reason: 'signup_bonus',
      note: 'Welcome',
      generationId: null,
      idempotencyKey: null,
    });
    expect(entry.id).toMatch(/^led_/);
    expect(getBalance(db, user.id)).toBe(50);
    grantCredits(db, { userId: user.id, amount: 5, reason: 'purchase' });
    expect(getBalance(db, user.id)).toBe(55);
    expectConsistentLedger(db, user.id, 0);
  });

  it('touches updatedAt', () => {
    const user = seedUser(db, { updatedAt: 1 });
    grantCredits(db, { userId: user.id, amount: 1, reason: 'admin_grant' });
    expect(db.select().from(users).where(eq(users.id, user.id)).get()?.updatedAt).toBeGreaterThan(
      1,
    );
  });

  it.each([
    0,
    -5,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_CREDIT_AMOUNT + 1,
    Number.MAX_SAFE_INTEGER + 2,
  ])('rejects the amount %s without writing anything', (amount) => {
    const user = seedUser(db, { creditBalance: 10 });
    expect(
      thrown(() => grantCredits(db, { userId: user.id, amount, reason: 'admin_grant' })),
    ).toMatchObject({
      code: 'bad_request',
    });
    expect(getBalance(db, user.id)).toBe(10);
    expect(ledgerCount()).toBe(0);
  });

  it('accepts the largest allowed amount', () => {
    const user = seedUser(db, { creditBalance: 0 });
    grantCredits(db, { userId: user.id, amount: MAX_CREDIT_AMOUNT, reason: 'adjustment' });
    expect(getBalance(db, user.id)).toBe(MAX_CREDIT_AMOUNT);
  });

  it('only grants for grant-like reasons; generation and refund have their own functions', () => {
    const user = seedUser(db);
    for (const reason of ['generation', 'refund', 'bogus']) {
      expect(
        thrown(() =>
          grantCredits(db, { userId: user.id, amount: 1, reason: reason as 'purchase' }),
        ),
      ).toMatchObject({ code: 'bad_request' });
    }
    expect(ledgerCount()).toBe(0);
  });

  it('throws not_found for an unknown user and leaves no ledger row behind', () => {
    expect(
      thrown(() => grantCredits(db, { userId: 'usr_missing', amount: 5, reason: 'admin_grant' })),
    ).toMatchObject({
      code: 'not_found',
    });
    expect(ledgerCount()).toBe(0);
  });

  describe('idempotencyKey', () => {
    it('applies a grant once however often it is replayed', () => {
      const user = seedUser(db, { creditBalance: 0 });
      const input = {
        userId: user.id,
        amount: 50,
        reason: 'signup_bonus',
        idempotencyKey: `signup:${user.id}`,
      } as const;
      const first = grantCredits(db, input);
      const second = grantCredits(db, input);
      const third = grantCredits(db, input);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
      expect(getBalance(db, user.id)).toBe(50);
      expect(ledgerCount()).toBe(1);
    });

    it('refuses to reuse a key for a different operation', () => {
      const a = seedUser(db, { creditBalance: 0 });
      const b = seedUser(db, { creditBalance: 0 });
      grantCredits(db, { userId: a.id, amount: 10, reason: 'purchase', idempotencyKey: 'order:1' });
      const reuse = (overrides: Record<string, unknown>) =>
        thrown(() =>
          grantCredits(db, {
            userId: a.id,
            amount: 10,
            reason: 'purchase',
            idempotencyKey: 'order:1',
            ...overrides,
          }),
        );
      expect(reuse({ amount: 11 })).toMatchObject({ code: 'conflict', status: 409 });
      expect(reuse({ userId: b.id })).toMatchObject({ code: 'conflict' });
      expect(reuse({ reason: 'admin_grant' })).toMatchObject({ code: 'conflict' });
      expect(reuse({ generationId: 'gen_x' })).toMatchObject({ code: 'conflict' });
      expect(getBalance(db, a.id)).toBe(10);
      expect(getBalance(db, b.id)).toBe(0);
      expect(ledgerCount()).toBe(1);
    });

    it('is shared with debits: a grant key cannot be replayed as a debit', () => {
      const user = seedUser(db, { creditBalance: 10 });
      grantCredits(db, {
        userId: user.id,
        amount: 5,
        reason: 'purchase',
        idempotencyKey: 'shared',
      });
      expect(
        thrown(() =>
          debitCredits(db, {
            userId: user.id,
            amount: 5,
            generationId: 'gen_1',
            idempotencyKey: 'shared',
          }),
        ),
      ).toMatchObject({ code: 'conflict' });
      expect(getBalance(db, user.id)).toBe(15);
    });

    it('distinct keys are independent grants', () => {
      const user = seedUser(db, { creditBalance: 0 });
      grantCredits(db, { userId: user.id, amount: 5, reason: 'purchase', idempotencyKey: 'k1' });
      grantCredits(db, { userId: user.id, amount: 5, reason: 'purchase', idempotencyKey: 'k2' });
      expect(getBalance(db, user.id)).toBe(10);
    });
  });

  it('stores a generation id when given', () => {
    const user = seedUser(db, { creditBalance: 0 });
    const entry = grantCredits(db, {
      userId: user.id,
      amount: 3,
      reason: 'adjustment',
      generationId: 'gen_abc',
    });
    expect(entry.generationId).toBe('gen_abc');
  });
});

describe('debitCredits', () => {
  it('charges the user and records a negative ledger entry for the generation', () => {
    const user = seedUser(db, { creditBalance: 10 });
    const entry = debitCredits(db, { userId: user.id, amount: 4, generationId: 'gen_1' });
    expect(entry).toMatchObject({
      delta: -4,
      balanceAfter: 6,
      reason: 'generation',
      generationId: 'gen_1',
    });
    expect(getBalance(db, user.id)).toBe(6);
  });

  it('can spend the balance down to exactly zero', () => {
    const user = seedUser(db, { creditBalance: 5 });
    expect(
      debitCredits(db, { userId: user.id, amount: 5, generationId: 'gen_1' }).balanceAfter,
    ).toBe(0);
    expect(getBalance(db, user.id)).toBe(0);
  });

  it('refuses to overdraw: insufficient_credits, balance and ledger untouched', () => {
    const user = seedUser(db, { creditBalance: 3 });
    const error = thrown(() =>
      debitCredits(db, { userId: user.id, amount: 4, generationId: 'gen_1' }),
    );
    expect(error).toMatchObject({
      code: 'insufficient_credits',
      status: 402,
      details: { required: 4, balance: 3 },
    });
    expect(getBalance(db, user.id)).toBe(3);
    expect(ledgerCount()).toBe(0);
  });

  it('refuses any debit from an empty balance', () => {
    const user = seedUser(db, { creditBalance: 0 });
    expect(
      thrown(() => debitCredits(db, { userId: user.id, amount: 1, generationId: 'gen_1' })).code,
    ).toBe('insufficient_credits');
  });

  it.each([0, -1, 2.5, Number.NaN, MAX_CREDIT_AMOUNT + 1])('rejects the amount %s', (amount) => {
    const user = seedUser(db, { creditBalance: 100 });
    expect(
      thrown(() => debitCredits(db, { userId: user.id, amount, generationId: 'gen_1' })).code,
    ).toBe('bad_request');
    expect(getBalance(db, user.id)).toBe(100);
  });

  it('throws not_found for an unknown user', () => {
    expect(
      thrown(() => debitCredits(db, { userId: 'usr_missing', amount: 1, generationId: 'gen_1' }))
        .code,
    ).toBe('not_found');
  });

  it('charges once per idempotency key and rejects a mismatched replay', () => {
    const user = seedUser(db, { creditBalance: 10 });
    const input = {
      userId: user.id,
      amount: 3,
      generationId: 'gen_1',
      idempotencyKey: 'debit:gen_1',
    };
    const first = debitCredits(db, input);
    expect(debitCredits(db, input)).toEqual(first);
    expect(getBalance(db, user.id)).toBe(7);
    expect(thrown(() => debitCredits(db, { ...input, amount: 4 })).code).toBe('conflict');
    expect(thrown(() => debitCredits(db, { ...input, generationId: 'gen_2' })).code).toBe(
      'conflict',
    );
    expect(getBalance(db, user.id)).toBe(7);
    expect(ledgerCount()).toBe(1);
  });

  it('a replayed debit succeeds even after the balance has since run out', () => {
    const user = seedUser(db, { creditBalance: 3 });
    const input = {
      userId: user.id,
      amount: 3,
      generationId: 'gen_1',
      idempotencyKey: 'debit:gen_1',
    };
    debitCredits(db, input);
    expect(getBalance(db, user.id)).toBe(0);
    expect(() => debitCredits(db, input)).not.toThrow();
    expect(getBalance(db, user.id)).toBe(0);
  });
});

describe('refundGeneration', () => {
  function charged(amount: number, balance = 20) {
    const user = seedUser(db, { creditBalance: balance });
    const generationId = newId('gen');
    debitCredits(db, { userId: user.id, amount, generationId });
    return { user, generationId };
  }

  it('gives back the full debit', () => {
    const { user, generationId } = charged(5);
    const entry = refundGeneration(db, generationId, { note: 'Generation failed' });
    expect(entry).toMatchObject({
      userId: user.id,
      delta: 5,
      balanceAfter: 20,
      reason: 'refund',
      generationId,
      note: 'Generation failed',
    });
    expect(getBalance(db, user.id)).toBe(20);
    expectConsistentLedger(db, user.id, 20);
  });

  it('is idempotent: refunding again does nothing', () => {
    const { user, generationId } = charged(5);
    expect(refundGeneration(db, generationId)).not.toBeNull();
    expect(refundGeneration(db, generationId)).toBeNull();
    expect(refundGeneration(db, generationId)).toBeNull();
    expect(getBalance(db, user.id)).toBe(20);
    expect(ledgerInOrder(db, user.id).map((row) => row.reason)).toEqual(['generation', 'refund']);
  });

  it('returns null when the generation was never charged', () => {
    seedUser(db);
    expect(refundGeneration(db, newId('gen'))).toBeNull();
    expect(ledgerCount()).toBe(0);
  });

  it('does not treat a grant that mentions a generation as something to refund', () => {
    const user = seedUser(db, { creditBalance: 0 });
    grantCredits(db, { userId: user.id, amount: 10, reason: 'admin_grant', generationId: 'gen_x' });
    expect(refundGeneration(db, 'gen_x')).toBeNull();
    expect(getBalance(db, user.id)).toBe(10);
  });

  describe('partial refunds', () => {
    it('refund exactly the requested amount, then only what is left', () => {
      const { user, generationId } = charged(10, 30);
      expect(refundGeneration(db, generationId, { amount: 3 })).toMatchObject({
        delta: 3,
        balanceAfter: 23,
      });
      expect(refundGeneration(db, generationId, { amount: 4 })).toMatchObject({
        delta: 4,
        balanceAfter: 27,
      });
      expect(refundGeneration(db, generationId)).toMatchObject({ delta: 3, balanceAfter: 30 });
      expect(refundGeneration(db, generationId)).toBeNull();
      expect(refundGeneration(db, generationId, { amount: 1 })).toBeNull();
      expect(getBalance(db, user.id)).toBe(30);
      expectConsistentLedger(db, user.id, 30);
    });

    it('never refund more than was debited, however much is asked', () => {
      const { user, generationId } = charged(10, 30);
      expect(refundGeneration(db, generationId, { amount: 999 })).toMatchObject({ delta: 10 });
      expect(refundGeneration(db, generationId, { amount: 999 })).toBeNull();
      expect(getBalance(db, user.id)).toBe(30);
    });

    it('cap the second request to what remains after the first', () => {
      const { generationId } = charged(10, 30);
      refundGeneration(db, generationId, { amount: 7 });
      expect(refundGeneration(db, generationId, { amount: 7 })).toMatchObject({ delta: 3 });
    });

    it('can be made replay-safe with an idempotency key', () => {
      const { user, generationId } = charged(10, 30);
      const key = `shortfall:${generationId}`;
      const first = refundGeneration(db, generationId, { amount: 4, idempotencyKey: key });
      const replay = refundGeneration(db, generationId, { amount: 4, idempotencyKey: key });
      expect(replay).toEqual(first);
      expect(getBalance(db, user.id)).toBe(24);
      expect(ledgerInOrder(db, user.id)).toHaveLength(2);
    });

    it('refuses to reuse a refund key for another generation or another kind of entry', () => {
      const one = charged(10, 30);
      const two = charged(10, 30);
      refundGeneration(db, one.generationId, { amount: 1, idempotencyKey: 'refund-key' });
      expect(
        thrown(() =>
          refundGeneration(db, two.generationId, { amount: 1, idempotencyKey: 'refund-key' }),
        ).code,
      ).toBe('conflict');
      grantCredits(db, {
        userId: one.user.id,
        amount: 1,
        reason: 'purchase',
        idempotencyKey: 'grant-key',
      });
      expect(
        thrown(() => refundGeneration(db, one.generationId, { idempotencyKey: 'grant-key' })).code,
      ).toBe('conflict');
    });

    it.each([0, -2, 1.5, Number.NaN])('reject the amount %s', (amount) => {
      const { generationId } = charged(10);
      expect(thrown(() => refundGeneration(db, generationId, { amount })).code).toBe('bad_request');
      expect(ledgerCount()).toBe(1);
    });
  });

  it('refunds the user who paid and leaves other generations alone', () => {
    const a = charged(4, 10);
    const b = charged(6, 10);
    refundGeneration(db, a.generationId);
    expect(getBalance(db, a.user.id)).toBe(10);
    expect(getBalance(db, b.user.id)).toBe(4);
    refundGeneration(db, b.generationId);
    expect(getBalance(db, b.user.id)).toBe(10);
  });

  it('works after the refunded credits were already spent elsewhere', () => {
    const { user, generationId } = charged(20, 20);
    expect(getBalance(db, user.id)).toBe(0);
    refundGeneration(db, generationId);
    expect(getBalance(db, user.id)).toBe(20);
  });
});

describe('invariants under a long random sequence of operations', () => {
  // Deterministic PRNG (mulberry32) so a failing seed reproduces.
  function random(seed: number) {
    let state = seed;
    return (max: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4_294_967_296) * max);
    };
  }

  it.each([1, 2, 3, 4, 5])(
    'seed %i: balance never negative, chain consistent, refunds bounded',
    (seed) => {
      const next = random(seed);
      const user = seedUser(db, { creditBalance: 25 });
      const paid = new Map<string, number>();
      const refunded = new Map<string, number>();
      let rejected = 0;

      for (let step = 0; step < 400; step++) {
        const choice = next(10);
        try {
          if (choice < 5) {
            const generationId = newId('gen');
            const amount = 1 + next(12);
            debitCredits(db, { userId: user.id, amount, generationId });
            paid.set(generationId, amount);
          } else if (choice < 7) {
            grantCredits(db, { userId: user.id, amount: 1 + next(15), reason: 'admin_grant' });
          } else {
            const ids = [...paid.keys()];
            const generationId = ids[next(ids.length)] ?? newId('gen');
            const asked = next(2) === 0 ? undefined : 1 + next(15);
            const entry = refundGeneration(
              db,
              generationId,
              asked === undefined ? {} : { amount: asked },
            );
            if (entry) refunded.set(generationId, (refunded.get(generationId) ?? 0) + entry.delta);
          }
        } catch (error) {
          if (isAppError(error) && error.code === 'insufficient_credits') rejected += 1;
          else throw error;
        }
        expect(getBalance(db, user.id)).toBeGreaterThanOrEqual(0);
      }

      expect(rejected).toBeGreaterThan(0); // the sequence really did hit the overdraw path
      for (const [generationId, amount] of refunded) {
        expect(amount, generationId).toBeLessThanOrEqual(paid.get(generationId) ?? 0);
      }
      expectConsistentLedger(db, user.id, 25);
    },
  );
});

describe('transactions', () => {
  it('a debit rolls back with its enclosing transaction (debit + generation insert are atomic)', () => {
    const user = seedUser(db, { creditBalance: 10 });
    expect(() =>
      withTx(db, (tx) => {
        debitCredits(tx, { userId: user.id, amount: 4, generationId: 'gen_1' });
        grantCredits(tx, { userId: user.id, amount: 1, reason: 'admin_grant' });
        throw new Error('insert of the generation failed');
      }),
    ).toThrow('insert of the generation failed');
    expect(getBalance(db, user.id)).toBe(10);
    expect(ledgerCount()).toBe(0);
  });

  it('a failed debit inside a transaction does not poison the work done before it', () => {
    const user = seedUser(db, { creditBalance: 5 });
    withTx(db, (tx) => {
      debitCredits(tx, { userId: user.id, amount: 3, generationId: 'gen_ok' });
      expect(
        thrown(() => debitCredits(tx, { userId: user.id, amount: 3, generationId: 'gen_too_much' }))
          .code,
      ).toBe('insufficient_credits');
    });
    expect(getBalance(db, user.id)).toBe(2);
    expect(ledgerInOrder(db, user.id)).toHaveLength(1);
  });

  it('sees uncommitted state of the enclosing transaction', () => {
    const user = seedUser(db, { creditBalance: 5 });
    withTx(db, (tx) => {
      debitCredits(tx, { userId: user.id, amount: 5, generationId: 'gen_1' });
      expect(getBalance(tx, user.id)).toBe(0);
      expect(
        thrown(() => debitCredits(tx, { userId: user.id, amount: 1, generationId: 'gen_2' })).code,
      ).toBe('insufficient_credits');
    });
  });
});

describe('listLedger', () => {
  function seedLedger(count: number) {
    const user = seedUser(db, { creditBalance: 0 });
    for (let i = 0; i < count; i++) {
      grantCredits(db, {
        userId: user.id,
        amount: i + 1,
        reason: 'admin_grant',
        note: `grant ${i}`,
      });
    }
    return user;
  }

  it('returns the newest entries first with a cursor while more remain', () => {
    const user = seedLedger(5);
    const first = listLedger(db, user.id, { limit: 2 });
    expect(first.data.map((entry) => entry.note)).toEqual(['grant 4', 'grant 3']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = listLedger(db, user.id, { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.data.map((entry) => entry.note)).toEqual(['grant 2', 'grant 1']);
    const third = listLedger(db, user.id, { limit: 2, cursor: second.nextCursor ?? undefined });
    expect(third.data.map((entry) => entry.note)).toEqual(['grant 0']);
    expect(third.nextCursor).toBeNull();
  });

  it('pages through everything exactly once', () => {
    const user = seedLedger(25);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = listLedger(db, user.id, { limit: 10, cursor });
      seen.push(...page.data.map((entry) => entry.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('keeps a stable order when many entries share one millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const user = seedLedger(12);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = listLedger(db, user.id, { limit: 5, cursor });
      seen.push(...page.data.map((entry) => entry.note ?? ''));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `grant ${11 - i}`));
  });

  it('has no cursor when everything fits on one page', () => {
    const user = seedLedger(3);
    expect(listLedger(db, user.id, { limit: 3 }).nextCursor).toBeNull();
    expect(listLedger(db, user.id).data).toHaveLength(3);
  });

  it('only returns the requested user’s entries', () => {
    const mine = seedLedger(2);
    seedLedger(4);
    expect(listLedger(db, mine.id).data).toHaveLength(2);
    expect(listLedger(db, 'usr_nobody')).toEqual({ data: [], nextCursor: null });
  });

  it('clamps the limit to 1..100', () => {
    const user = seedLedger(3);
    expect(listLedger(db, user.id, { limit: 0 }).data).toHaveLength(1);
    expect(listLedger(db, user.id, { limit: -5 }).data).toHaveLength(1);
    expect(listLedger(db, user.id, { limit: 1000 }).data).toHaveLength(3);
    expect(listLedger(db, user.id, { limit: 1.9 }).data).toHaveLength(1);
  });

  it('rejects cursors it did not issue', () => {
    const user = seedLedger(1);
    for (const cursor of ['garbage', '', 'W10', 'WyJ4IiwxXQ']) {
      expect(thrown(() => listLedger(db, user.id, { cursor })).code).toBe('bad_request');
    }
  });

  it('maps rows to the wire DTO without null fields', () => {
    const user = seedUser(db, { creditBalance: 10 });
    const debit = debitCredits(db, { userId: user.id, amount: 2, generationId: 'gen_1' });
    const grant = grantCredits(db, {
      userId: user.id,
      amount: 5,
      reason: 'purchase',
      note: 'Pack',
    });
    const { data } = listLedger(db, user.id);
    expect(data).toEqual([
      {
        id: grant.id,
        delta: 5,
        balanceAfter: 13,
        reason: 'purchase',
        note: 'Pack',
        createdAt: grant.createdAt,
      },
      {
        id: debit.id,
        delta: -2,
        balanceAfter: 8,
        reason: 'generation',
        generationId: 'gen_1',
        createdAt: debit.createdAt,
      },
    ]);
    expect(toLedgerEntryDTO(grant)).not.toHaveProperty('generationId');
    expect(toLedgerEntryDTO(debit)).not.toHaveProperty('note');
    expect(toLedgerEntryDTO(debit)).not.toHaveProperty('userId');
    expect(toLedgerEntryDTO(debit)).not.toHaveProperty('idempotencyKey');
  });
});
