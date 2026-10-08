import { newId } from '@/lib/id';
import { debitCredits } from '@/server/credits';
import type { Db } from '@/server/db';
import type { GenerationRow, NewGenerationRow, UserRow } from '@/server/db/schema';
import type { PersistedOutput } from '@/server/uploads';
import { createGeneration } from '../../helpers/factories';

/**
 * A queued generation the way `createGeneration` leaves it: the credits are debited, so refund
 * accounting in the tests is real. Defaults to one 1:1 Demo image costing 1 credit.
 */
export function queue(
  db: Db,
  user: Pick<UserRow, 'id'>,
  overrides: Partial<NewGenerationRow> = {},
): GenerationRow {
  const id = overrides.id ?? newId('gen');
  const cost = overrides.cost ?? 1;
  debitCredits(db, { userId: user.id, amount: cost, generationId: id });
  return createGeneration(db, { userId: user.id, ...overrides, id, cost });
}

export function persisted(index = 0, overrides: Partial<PersistedOutput> = {}): PersistedOutput {
  const assetId = overrides.assetId ?? newId('ast');
  return {
    assetId,
    index,
    kind: 'image',
    storageKey: `u/usr_test/gen_test/${assetId}.png`,
    thumbKey: `u/usr_test/gen_test/${assetId}.thumb.webp`,
    mimeType: 'image/png',
    bytes: 100 + index,
    width: 64,
    height: 64,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}
