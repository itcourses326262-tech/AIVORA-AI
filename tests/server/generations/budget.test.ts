import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateGenerationRequest } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import {
  BUDGET_WINDOW_MS,
  MAX_RETRY_AFTER_SEC,
  MIN_RETRY_AFTER_SEC,
  assertWithinUpstreamBudget,
  committedUpstreamCredits,
  resetBudgetLogForTests,
} from '@/server/generations/budget';
import { cancelGeneration, createGeneration } from '@/server/generations/service';
import { resetLoggerForTests } from '@/server/logger';
import { setProviderOverrides } from '@/server/providers/registry';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import {
  createGeneration as insertGeneration,
  createUser,
  fakeProvider,
} from '../../helpers/factories';

/*
 * DAILY_UPSTREAM_BUDGET_CREDITS: the most credits that may be committed to paid (non-Demo)
 * generations per rolling 24 hours. Committed = cost of the generations created in that window that
 * are not failed or canceled (those were refunded in full). A request that would push the total
 * past the budget fails with 503 `service_busy` and a Retry-After; reaching it exactly is fine.
 */

const harness = freshDb();
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function paid(overrides: Partial<Parameters<typeof insertGeneration>[1]> = {}) {
  return insertGeneration(harness.db, {
    userId: createUser(harness.db).id,
    provider: 'fal',
    modelId: 'fal-flux-schnell',
    status: 'succeeded',
    cost: 1,
    createdAt: NOW - HOUR,
    ...overrides,
  });
}

function refusal(check: Parameters<typeof assertWithinUpstreamBudget>[1]): AppError {
  try {
    assertWithinUpstreamBudget(harness.db, check);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected service_busy');
}

beforeEach(() => resetBudgetLogForTests());

describe('committedUpstreamCredits', () => {
  it('sums the cost of paid generations that are queued, processing or succeeded', () => {
    paid({ status: 'queued', cost: 3 });
    paid({ status: 'processing', cost: 5 });
    paid({ status: 'succeeded', cost: 7 });
    expect(committedUpstreamCredits(harness.db, NOW)).toBe(15);
  });

  it('leaves out failed and canceled generations: they were refunded in full', () => {
    paid({ status: 'failed', cost: 11 });
    paid({ status: 'canceled', cost: 13 });
    paid({ status: 'queued', cost: 2 });
    expect(committedUpstreamCredits(harness.db, NOW)).toBe(2);
  });

  it('never counts the Demo provider', () => {
    paid({ provider: 'mock', modelId: 'aivore-demo-image', cost: 99 });
    paid({ cost: 4 });
    expect(committedUpstreamCredits(harness.db, NOW)).toBe(4);
  });

  it('counts every paid provider and every user together', () => {
    paid({ provider: 'fal', cost: 1 });
    paid({ provider: 'openai', cost: 2 });
    paid({ provider: 'replicate', cost: 4 });
    expect(committedUpstreamCredits(harness.db, NOW)).toBe(7);
  });

  it('looks back exactly 24 hours: a generation that old has aged out, one millisecond younger has not', () => {
    paid({ cost: 100, createdAt: NOW - BUDGET_WINDOW_MS });
    paid({ cost: 10, createdAt: NOW - BUDGET_WINDOW_MS + 1 });
    paid({ cost: 1, createdAt: NOW });
    expect(committedUpstreamCredits(harness.db, NOW)).toBe(11);
    expect(committedUpstreamCredits(harness.db, NOW + 1)).toBe(1);
  });

  it('is zero for an empty table', () => {
    expect(committedUpstreamCredits(harness.db, NOW)).toBe(0);
  });
});

describe('assertWithinUpstreamBudget', () => {
  it('is off when the budget is 0 (the default), whatever has been spent', () => {
    paid({ cost: 1_000_000 });
    expect(() =>
      assertWithinUpstreamBudget(harness.db, { cost: 1_000_000, budget: 0, now: NOW }),
    ).not.toThrow();
  });

  it('allows a request that lands exactly on the budget and refuses one credit more', () => {
    paid({ cost: 90 });
    expect(() =>
      assertWithinUpstreamBudget(harness.db, { cost: 10, budget: 100, now: NOW }),
    ).not.toThrow();
    const error = refusal({ cost: 11, budget: 100, now: NOW });
    expect(error).toMatchObject({ code: 'service_busy', status: 503 });
  });

  it('refuses a request bigger than the whole budget, even when nothing is committed', () => {
    expect(refusal({ cost: 101, budget: 100, now: NOW })).toMatchObject({ code: 'service_busy' });
  });

  it('allows again once a committed generation fails or is canceled (refunded)', () => {
    const running = paid({ status: 'processing', cost: 90 });
    expect(refusal({ cost: 20, budget: 100, now: NOW }).code).toBe('service_busy');
    harness.db
      .update(generations)
      .set({ status: 'failed' })
      .where(eq(generations.id, running.id))
      .run();
    expect(() =>
      assertWithinUpstreamBudget(harness.db, { cost: 20, budget: 100, now: NOW }),
    ).not.toThrow();
  });

  it('allows again once the oldest generations leave the 24 hour window', () => {
    paid({ cost: 95, createdAt: NOW - BUDGET_WINDOW_MS + 5_000 });
    expect(refusal({ cost: 10, budget: 100, now: NOW }).code).toBe('service_busy');
    expect(() =>
      assertWithinUpstreamBudget(harness.db, { cost: 10, budget: 100, now: NOW + 5_000 }),
    ).not.toThrow();
  });

  describe('Retry-After', () => {
    const retryAfter = (error: AppError) =>
      (error.details as { retryAfterSec: number }).retryAfterSec;

    it('estimates when enough of the window rolls off for the request to fit', () => {
      paid({ cost: 10, createdAt: NOW - BUDGET_WINDOW_MS + 30 * 60 * 1000 });
      paid({ cost: 90, createdAt: NOW - HOUR });
      // 100 committed, budget 100, new 5: the oldest generation (10) frees enough, in 30 minutes.
      expect(retryAfter(refusal({ cost: 5, budget: 100, now: NOW }))).toBe(1800);
    });

    it('uses the generation that actually frees enough, not just the oldest one', () => {
      paid({ cost: 1, createdAt: NOW - BUDGET_WINDOW_MS + 10 * 60 * 1000 });
      paid({ cost: 50, createdAt: NOW - BUDGET_WINDOW_MS + 50 * 60 * 1000 });
      paid({ cost: 49, createdAt: NOW - HOUR });
      // excess = 100 + 20 - 100 = 20: the 1 is not enough, the 50 (rolling off in 50 minutes) is.
      expect(retryAfter(refusal({ cost: 20, budget: 100, now: NOW }))).toBe(3000);
    });

    it('is never below a minute or above an hour', () => {
      paid({ cost: 100, createdAt: NOW - BUDGET_WINDOW_MS + 5_000 });
      expect(retryAfter(refusal({ cost: 1, budget: 100, now: NOW }))).toBe(MIN_RETRY_AFTER_SEC);
    });

    it('is the maximum when the room would take more than an hour, or never appears', () => {
      paid({ cost: 100, createdAt: NOW - HOUR });
      expect(retryAfter(refusal({ cost: 1, budget: 100, now: NOW }))).toBe(MAX_RETRY_AFTER_SEC);
      expect(retryAfter(refusal({ cost: 1_000, budget: 100, now: NOW }))).toBe(MAX_RETRY_AFTER_SEC);
    });
  });

  describe('logging', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      resetLoggerForTests();
    });

    it('says so once a minute at most, with numbers and no user data', () => {
      paid({ cost: 100 });
      vi.stubEnv('LOG_LEVEL', 'warn');
      resetLoggerForTests();
      const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      for (let index = 0; index < 5; index += 1) {
        refusal({ cost: 1, budget: 100, now: NOW + index * 1000 });
      }
      expect(write).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(line).toMatchObject({ level: 'warn', budget: 100, committed: 100, cost: 1 });
      expect(Object.keys(line)).not.toContain('userId');

      refusal({ cost: 1, budget: 100, now: NOW + 61_000 });
      expect(write).toHaveBeenCalledTimes(2);
      vi.unstubAllEnvs();
    });
  });
});

describe('createGeneration with DAILY_UPSTREAM_BUDGET_CREDITS', () => {
  const FAL: CreateGenerationRequest = {
    tool: 'text-to-image',
    modelId: 'fal-flux-schnell', // 1 credit per image
    prompt: 'A lighthouse at dawn',
  };
  const DEMO: CreateGenerationRequest = {
    tool: 'text-to-image',
    modelId: 'aivore-demo-image',
    prompt: 'A lighthouse at dawn',
  };

  beforeEach(() => {
    vi.stubEnv('FAL_KEY', 'test-key-never-sent-anywhere');
    vi.stubEnv('MAX_ACTIVE_PER_USER', '100');
    vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '3');
    resetEnvForTests();
    setProviderOverrides({ fal: fakeProvider({ id: 'fal' }) });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
    setProviderOverrides(null);
  });

  async function failure(promise: Promise<unknown>): Promise<AppError> {
    const error = await promise.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  it('creates paid generations up to the budget and then answers 503 service_busy', async () => {
    const user = createUser(harness.db, { creditBalance: 100 });
    for (let index = 0; index < 3; index += 1) {
      await createGeneration(user.id, { ...FAL, prompt: `lighthouse ${index}` });
    }
    const error = await failure(createGeneration(user.id, { ...FAL, prompt: 'one too many' }));
    expect(error).toMatchObject({ code: 'service_busy', status: 503 });
    expect((error.details as { retryAfterSec: number }).retryAfterSec).toBeGreaterThanOrEqual(60);

    // The refused request left nothing behind: no row, no debit.
    expect(harness.db.select().from(generations).all()).toHaveLength(3);
    expect(getBalance(harness.db, user.id)).toBe(97);
    expectConsistentLedger(harness.db, user.id, 100);
  });

  it('shares the budget between users', async () => {
    const alice = createUser(harness.db);
    const bob = createUser(harness.db);
    await createGeneration(alice.id, { ...FAL, params: { count: 2 } });
    await createGeneration(bob.id, FAL);
    expect(await failure(createGeneration(alice.id, FAL))).toMatchObject({ code: 'service_busy' });
    expect(await failure(createGeneration(bob.id, FAL))).toMatchObject({ code: 'service_busy' });
  });

  it('never applies to the Demo provider, even when the paid budget is spent', async () => {
    const user = createUser(harness.db, { creditBalance: 100 });
    await createGeneration(user.id, { ...FAL, params: { count: 3 } });
    expect(await failure(createGeneration(user.id, FAL))).toMatchObject({ code: 'service_busy' });
    await expect(createGeneration(user.id, DEMO)).resolves.toMatchObject({ created: true });
    // And Demo generations do not use up any of the paid budget.
    expect(committedUpstreamCredits(harness.db)).toBe(3);
  });

  it('is a no-op while the budget is 0 (the default)', async () => {
    vi.stubEnv('DAILY_UPSTREAM_BUDGET_CREDITS', '0');
    resetEnvForTests();
    const user = createUser(harness.db, { creditBalance: 100 });
    for (let index = 0; index < 8; index += 1) {
      await createGeneration(user.id, { ...FAL, prompt: `again ${index}` });
    }
    expect(harness.db.select().from(generations).all()).toHaveLength(8);
  });

  it('opens room again when a committed generation is canceled and refunded, no more than it took', async () => {
    const user = createUser(harness.db, { creditBalance: 100 });
    const first = await createGeneration(user.id, { ...FAL, params: { count: 2 } });
    await createGeneration(user.id, FAL);
    expect(await failure(createGeneration(user.id, FAL))).toMatchObject({ code: 'service_busy' });

    await cancelGeneration(user.id, first.generation.id); // refunds 2 credits, frees 2
    await createGeneration(user.id, { ...FAL, prompt: 'fits again' });
    await createGeneration(user.id, { ...FAL, prompt: 'and again' });
    expect(await failure(createGeneration(user.id, FAL))).toMatchObject({ code: 'service_busy' });
    expect(committedUpstreamCredits(harness.db)).toBe(3);
  });

  it('keeps succeeded generations committed: a finished picture was paid for', async () => {
    const user = createUser(harness.db, { creditBalance: 100 });
    const { generation } = await createGeneration(user.id, { ...FAL, params: { count: 3 } });
    harness.db
      .update(generations)
      .set({ status: 'succeeded' })
      .where(eq(generations.id, generation.id))
      .run();
    expect(await failure(createGeneration(user.id, FAL))).toMatchObject({ code: 'service_busy' });
  });

  it('keeps the full cost committed after a partial refund', async () => {
    const user = createUser(harness.db, { creditBalance: 100 });
    const { generation } = await createGeneration(user.id, { ...FAL, params: { count: 3 } });
    // 2 of 3 images arrived: the engine refunds a third, the generation stays succeeded.
    harness.db
      .update(generations)
      .set({ status: 'succeeded' })
      .where(eq(generations.id, generation.id))
      .run();
    expect(committedUpstreamCredits(harness.db)).toBe(3);
  });

  it('answers a replay of an earlier request even when the budget is now spent', async () => {
    const user = createUser(harness.db, { creditBalance: 100 });
    const first = await createGeneration(user.id, FAL, { idempotencyKey: 'k-1' });
    await createGeneration(user.id, { ...FAL, params: { count: 2 } });
    expect(await failure(createGeneration(user.id, { ...FAL, prompt: 'new' }))).toMatchObject({
      code: 'service_busy',
    });
    await expect(createGeneration(user.id, FAL, { idempotencyKey: 'k-1' })).resolves.toMatchObject({
      created: false,
      generation: { id: first.generation.id },
    });
  });

  it('puts the answer on the wire as 503 with a Retry-After header', async () => {
    const { POST } = await import('@/app/api/v1/generations/route');
    const { invokeRoute } = await import('../../helpers/http');
    const { createSession } = await import('../../helpers/factories');
    const user = createUser(harness.db, { creditBalance: 100 });
    const session = createSession(harness.db, user.id);
    await createGeneration(user.id, { ...FAL, params: { count: 3 } });

    const result = await invokeRoute<{
      error: { code: string; details?: { retryAfterSec: number } };
    }>(POST, { url: '/api/v1/generations', headers: session.headers, body: FAL });
    expect(result.status).toBe(503);
    expect(result.json.error.code).toBe('service_busy');
    expect(Number(result.headers.get('retry-after'))).toBe(
      result.json.error.details?.retryAfterSec,
    );
    expect(Number(result.headers.get('retry-after'))).toBeGreaterThanOrEqual(60);
  });
});
