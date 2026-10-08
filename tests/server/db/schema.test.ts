import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GenerationParams } from '@/lib/catalog/types';
import { newId } from '@/lib/id';
import type { Db } from '@/server/db';
import {
  apiKeys,
  assets,
  creditLedger,
  generations,
  sessions,
  users,
  type NewAssetRow,
  type NewGenerationRow,
  type NewLedgerEntry,
} from '@/server/db/schema';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

let test: TestDb;
let db: Db;

beforeEach(() => {
  test = createTestDb();
  db = test.db;
});

afterEach(() => {
  test.close();
});

const params: GenerationParams = { aspectRatio: '16:9', count: 2, seed: 7 };

function generation(userId: string, overrides: Partial<NewGenerationRow> = {}): NewGenerationRow {
  const now = Date.now();
  return {
    id: newId('gen'),
    userId,
    tool: 'text-to-image',
    kind: 'image',
    modelId: 'aivore-demo-image',
    provider: 'mock',
    prompt: 'a red fox',
    params,
    cost: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function asset(userId: string, overrides: Partial<NewAssetRow> = {}): NewAssetRow {
  return {
    id: newId('ast'),
    userId,
    role: 'output',
    kind: 'image',
    storageKey: `u/${userId}/x/${newId('ast')}.png`,
    mimeType: 'image/png',
    bytes: 10,
    createdAt: Date.now(),
    ...overrides,
  };
}

function ledger(userId: string, overrides: Partial<NewLedgerEntry> = {}): NewLedgerEntry {
  return {
    id: newId('led'),
    userId,
    delta: 5,
    balanceAfter: 5,
    reason: 'admin_grant',
    createdAt: Date.now(),
    ...overrides,
  };
}

/** The SQLite error code a statement fails with, e.g. SQLITE_CONSTRAINT_CHECK. */
function failureCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
  return 'NO_ERROR';
}

describe('users', () => {
  it('stores defaults: role user, locale ar, no balance', () => {
    const now = Date.now();
    const row = db
      .insert(users)
      .values({
        id: newId('usr'),
        email: 'a@example.com',
        name: 'A',
        passwordHash: 'h',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    expect(row).toMatchObject({ role: 'user', locale: 'ar', creditBalance: 0, disabledAt: null });
  });

  it('refuses a negative credit balance (CHECK credit_balance >= 0)', () => {
    expect(failureCode(() => seedUser(db, { creditBalance: -1 }))).toBe('SQLITE_CONSTRAINT_CHECK');
    const user = seedUser(db, { creditBalance: 3 });
    expect(
      failureCode(() =>
        db.update(users).set({ creditBalance: -5 }).where(eq(users.id, user.id)).run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('keeps emails unique and lowercase', () => {
    seedUser(db, { email: 'dup@example.com' });
    expect(failureCode(() => seedUser(db, { email: 'dup@example.com' }))).toBe(
      'SQLITE_CONSTRAINT_UNIQUE',
    );
    expect(failureCode(() => seedUser(db, { email: 'Mixed@Example.com' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
  });

  it('only accepts known roles and locales', () => {
    expect(failureCode(() => seedUser(db, { role: 'root' as 'user' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(failureCode(() => seedUser(db, { locale: 'fr' as 'ar' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(seedUser(db, { role: 'admin', locale: 'en' })).toMatchObject({
      role: 'admin',
      locale: 'en',
    });
  });
});

describe('sessions and api keys', () => {
  const session = (userId: string, tokenHash: string) => ({
    id: newId('ses'),
    userId,
    tokenHash,
    expiresAt: Date.now() + 1000,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  it('requires an existing user', () => {
    expect(failureCode(() => db.insert(sessions).values(session('usr_missing', 'h1')).run())).toBe(
      'SQLITE_CONSTRAINT_FOREIGNKEY',
    );
  });

  it('keeps token and key hashes unique', () => {
    const user = seedUser(db);
    db.insert(sessions).values(session(user.id, 'same')).run();
    expect(failureCode(() => db.insert(sessions).values(session(user.id, 'same')).run())).toBe(
      'SQLITE_CONSTRAINT_UNIQUE',
    );
    const key = (hash: string) => ({
      id: newId('key'),
      userId: user.id,
      name: 'ci',
      prefix: 'avk_ab12cd34',
      keyHash: hash,
      createdAt: Date.now(),
    });
    db.insert(apiKeys).values(key('k1')).run();
    expect(failureCode(() => db.insert(apiKeys).values(key('k1')).run())).toBe(
      'SQLITE_CONSTRAINT_UNIQUE',
    );
  });

  it('are deleted with their user', () => {
    const user = seedUser(db);
    db.insert(sessions).values(session(user.id, 'h')).run();
    db.insert(apiKeys)
      .values({
        id: newId('key'),
        userId: user.id,
        name: 'n',
        prefix: 'p',
        keyHash: 'kh',
        createdAt: 1,
      })
      .run();
    db.delete(users).where(eq(users.id, user.id)).run();
    expect(db.select().from(sessions).all()).toEqual([]);
    expect(db.select().from(apiKeys).all()).toEqual([]);
  });
});

describe('credit_ledger', () => {
  it('rejects zero deltas, negative balances and unknown reasons', () => {
    const user = seedUser(db);
    expect(
      failureCode(() =>
        db
          .insert(creditLedger)
          .values(ledger(user.id, { delta: 0 }))
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      failureCode(() =>
        db
          .insert(creditLedger)
          .values(ledger(user.id, { balanceAfter: -1 }))
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      failureCode(() =>
        db
          .insert(creditLedger)
          .values(ledger(user.id, { reason: 'gift' as 'refund' }))
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    db.insert(creditLedger)
      .values(ledger(user.id, { delta: -3, balanceAfter: 0, reason: 'generation' }))
      .run();
  });

  it('makes idempotency keys globally unique but lets rows without a key repeat', () => {
    const a = seedUser(db);
    const b = seedUser(db);
    db.insert(creditLedger)
      .values(ledger(a.id, { idempotencyKey: 'grant:1' }))
      .run();
    expect(
      failureCode(() =>
        db
          .insert(creditLedger)
          .values(ledger(b.id, { idempotencyKey: 'grant:1' }))
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_UNIQUE');
    db.insert(creditLedger).values(ledger(a.id)).run();
    db.insert(creditLedger).values(ledger(a.id)).run();
    expect(db.select().from(creditLedger).all()).toHaveLength(3);
  });

  it('survives its generation: generation_id is a plain column, not a foreign key', () => {
    const user = seedUser(db);
    db.insert(creditLedger)
      .values(ledger(user.id, { generationId: 'gen_does_not_exist' }))
      .run();
    const gen = generation(user.id);
    db.insert(generations).values(gen).run();
    db.insert(creditLedger)
      .values(ledger(user.id, { generationId: gen.id }))
      .run();
    db.delete(generations).where(eq(generations.id, gen.id)).run();
    expect(db.select().from(creditLedger).all()).toHaveLength(2);
  });

  it('is deleted with its user', () => {
    const user = seedUser(db);
    db.insert(creditLedger).values(ledger(user.id)).run();
    db.delete(users).where(eq(users.id, user.id)).run();
    expect(db.select().from(creditLedger).all()).toEqual([]);
  });
});

describe('generations', () => {
  it('round-trips typed JSON, booleans and defaults', () => {
    const user = seedUser(db);
    const row = db
      .insert(generations)
      .values(
        generation(user.id, {
          providerMeta: { requestId: 'r1', nested: { a: [1, 2] } },
          isPublic: true,
        }),
      )
      .returning()
      .get();
    expect(row.params).toEqual(params);
    expect(row.providerMeta).toEqual({ requestId: 'r1', nested: { a: [1, 2] } });
    expect(row).toMatchObject({
      status: 'queued',
      progress: 0,
      attempts: 0,
      isPublic: true,
      isFavorite: false,
      negativePrompt: null,
      inputAssetId: null,
    });
  });

  it('enforces the status, tool, kind, provider and numeric invariants', () => {
    const user = seedUser(db);
    const insert = (overrides: Partial<NewGenerationRow>) =>
      failureCode(() => db.insert(generations).values(generation(user.id, overrides)).run());
    expect(insert({ status: 'paused' as 'queued' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ tool: 'text-to-audio' as 'text-to-image' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ kind: 'audio' as 'image' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ provider: 'acme' as 'mock' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ progress: 101 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ progress: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ cost: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ attempts: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ progress: 100, cost: 0 })).toBe('NO_ERROR');
  });

  it('keeps idempotency keys unique per user only', () => {
    const a = seedUser(db);
    const b = seedUser(db);
    const insert = (userId: string, key: string | null) =>
      failureCode(() =>
        db
          .insert(generations)
          .values(generation(userId, { idempotencyKey: key }))
          .run(),
      );
    expect(insert(a.id, 'k')).toBe('NO_ERROR');
    expect(insert(a.id, 'k')).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(insert(b.id, 'k')).toBe('NO_ERROR');
    expect(insert(a.id, null)).toBe('NO_ERROR');
    expect(insert(a.id, null)).toBe('NO_ERROR');
  });

  it('is deleted with its user, taking its assets along', () => {
    const user = seedUser(db);
    const gen = generation(user.id);
    db.insert(generations).values(gen).run();
    db.insert(assets)
      .values(asset(user.id, { generationId: gen.id }))
      .run();
    db.delete(users).where(eq(users.id, user.id)).run();
    expect(db.select().from(generations).all()).toEqual([]);
    expect(db.select().from(assets).all()).toEqual([]);
  });

  it('forgets a deleted input asset instead of failing (ON DELETE SET NULL)', () => {
    const user = seedUser(db);
    const input = asset(user.id, { role: 'input' });
    db.insert(assets).values(input).run();
    const gen = generation(user.id, { inputAssetId: input.id });
    db.insert(generations).values(gen).run();
    db.delete(assets).where(eq(assets.id, input.id)).run();
    expect(
      db.select().from(generations).where(eq(generations.id, gen.id)).get()?.inputAssetId,
    ).toBeNull();
  });

  it('rejects an input asset that does not exist', () => {
    const user = seedUser(db);
    expect(
      failureCode(() =>
        db
          .insert(generations)
          .values(generation(user.id, { inputAssetId: 'ast_missing' }))
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
  });
});

describe('assets', () => {
  it('cascades from the generation but keeps the uploader’s other assets', () => {
    const user = seedUser(db);
    const gen = generation(user.id);
    db.insert(generations).values(gen).run();
    const output = asset(user.id, { generationId: gen.id });
    const upload = asset(user.id, { role: 'input' });
    db.insert(assets).values([output, upload]).run();
    db.delete(generations).where(eq(generations.id, gen.id)).run();
    expect(
      db
        .select()
        .from(assets)
        .all()
        .map((row) => row.id),
    ).toEqual([upload.id]);
  });

  it('validates role, kind and sizes, and defaults the output index to 0', () => {
    const user = seedUser(db);
    const insert = (overrides: Partial<NewAssetRow>) =>
      failureCode(() => db.insert(assets).values(asset(user.id, overrides)).run());
    expect(insert({ role: 'thumb' as 'input' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ kind: 'audio' as 'image' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ bytes: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insert({ index: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(db.insert(assets).values(asset(user.id)).returning().get().index).toBe(0);
  });
});

describe('indexes', () => {
  const planFor = (query: string) =>
    (db.$client.prepare(`explain query plan ${query}`).all() as Array<{ detail: string }>)
      .map((row) => row.detail)
      .join(' | ');

  it('declares every index of the data model', () => {
    const names = (
      db.$client.prepare("select name from sqlite_master where type = 'index'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'generations_user_created_idx',
        'generations_status_lease_idx',
        'generations_public_created_idx',
        'generations_user_idempotency_uq',
        'credit_ledger_user_created_idx',
        'credit_ledger_idempotency_uq',
        'assets_generation_idx',
        'sessions_user_idx',
        'api_keys_user_idx',
        'users_email_unique',
        'sessions_token_hash_unique',
        'api_keys_key_hash_unique',
      ]),
    );
  });

  it('serves the hot queries from an index', () => {
    expect(
      planFor("select * from generations where user_id = 'u' order by created_at desc limit 20"),
    ).toContain('generations_user_created_idx');
    expect(
      planFor("select * from generations where status = 'queued' and lease_until < 5"),
    ).toContain('generations_status_lease_idx');
    expect(
      planFor('select * from generations where is_public = 1 order by created_at desc limit 20'),
    ).toContain('generations_public_created_idx');
    expect(
      planFor("select * from credit_ledger where user_id = 'u' order by created_at desc limit 20"),
    ).toContain('credit_ledger_user_created_idx');
    expect(planFor("select * from assets where generation_id = 'g'")).toContain(
      'assets_generation_idx',
    );
    expect(planFor("select * from sessions where token_hash = 'h'")).toContain(
      'sessions_token_hash_unique',
    );
  });
});
