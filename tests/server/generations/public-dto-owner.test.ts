import { describe, expect, it } from 'vitest';
import { toPublicGenerationDTO } from '@/server/generations/dto';
import { freshDb } from '../../helpers/db';
import { createGeneration, createUser } from '../../helpers/factories';

const ctx = freshDb();

describe('toPublicGenerationDTO owner name', () => {
  it.each([
    ['Layla Hassan', 'Layla'],
    ['  ليلى   حسن العلي ', 'ليلى'],
    ['layla@example.com', ''],
    ['', ''],
  ])('cuts %j to %j whatever the caller passes', (full, shown) => {
    const user = createUser(ctx.db);
    const row = createGeneration(ctx.db, { userId: user.id });
    const dto = toPublicGenerationDTO(row, { outputs: [], owner: { name: full } });
    expect(dto.owner).toEqual({ name: shown });
    expect(JSON.stringify(dto)).not.toContain('Hassan');
  });
});
