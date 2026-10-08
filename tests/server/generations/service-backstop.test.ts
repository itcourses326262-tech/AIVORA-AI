import { describe, expect, it, vi } from 'vitest';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { findByIdempotencyKey } from '@/server/generations/idempotency';
import { createGeneration } from '@/server/generations/service';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';

// Both lookups before the insert are blinded, so only the unique index can notice the duplicate.
vi.mock('@/server/generations/idempotency', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/generations/idempotency')>();
  return { ...original, findByIdempotencyKey: vi.fn(original.findByIdempotencyKey) };
});

const harness = freshDb();
const request = {
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'a quiet harbour',
} as const;

describe('the unique (userId, idempotencyKey) index as a backstop', () => {
  it('turns a lost race into a replay and rolls the second debit back', async () => {
    const user = createUser(harness.db);
    const first = await createGeneration(user.id, request, { idempotencyKey: 'k' });

    const lookup = vi.mocked(findByIdempotencyKey);
    const realLookup = lookup.getMockImplementation();
    lookup.mockReset();
    lookup.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    lookup.mockImplementation(realLookup ?? (() => undefined));

    const again = await createGeneration(user.id, request, { idempotencyKey: 'k' });
    expect(again).toMatchObject({ created: false, generation: { id: first.generation.id } });
    expect(harness.db.select().from(generations).all()).toHaveLength(1);
    expect(getBalance(harness.db, user.id)).toBe(49);
  });

  it('still reports the violation when no winner can be found', async () => {
    const user = createUser(harness.db);
    await createGeneration(user.id, request, { idempotencyKey: 'k' });
    vi.mocked(findByIdempotencyKey).mockReset().mockReturnValue(undefined);
    await expect(createGeneration(user.id, request, { idempotencyKey: 'k' })).rejects.toThrow();
    expect(getBalance(harness.db, user.id)).toBe(49);
  });
});
