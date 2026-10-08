import { describe, expect, it } from 'vitest';
import { toAssetDTO, toGenerationDTO } from '@/server/generations/dto';
import { createTestDb, type TestDb } from '../../helpers/db';
import { createAsset, createGeneration, createUser } from '../../helpers/factories';

function fixture(db: TestDb['db']) {
  const user = createUser(db);
  return { user, generation: createGeneration(db, { userId: user.id }) };
}

describe('toAssetDTO', () => {
  it('maps a stored image with thumbnail and dimensions', () => {
    const { db, close } = createTestDb();
    try {
      const { user } = fixture(db);
      const asset = createAsset(db, { userId: user.id, thumbKey: 'u/x/thumb.webp' });
      expect(toAssetDTO(asset)).toEqual({
        id: asset.id,
        kind: 'image',
        mimeType: 'image/png',
        bytes: 1024,
        width: 512,
        height: 512,
        url: `/api/v1/media/${asset.id}`,
        thumbUrl: `/api/v1/media/${asset.id}?variant=thumb`,
      });
    } finally {
      close();
    }
  });

  it('omits what is unknown and never exposes storage keys', () => {
    const { db, close } = createTestDb();
    try {
      const { user } = fixture(db);
      const asset = createAsset(db, {
        userId: user.id,
        kind: 'video',
        mimeType: 'image/gif',
        width: null,
        height: null,
        durationMs: 3000,
      });
      const dto = toAssetDTO(asset);
      expect(dto).not.toHaveProperty('width');
      expect(dto).not.toHaveProperty('thumbUrl');
      expect(dto.durationMs).toBe(3000);
      expect(JSON.stringify(dto)).not.toContain('storageKey');
      expect(JSON.stringify(dto)).not.toContain(asset.storageKey);
    } finally {
      close();
    }
  });
});

describe('toGenerationDTO', () => {
  it('maps a queued generation and hides internal fields', () => {
    const { db, close } = createTestDb();
    try {
      const { generation } = fixture(db);
      const dto = toGenerationDTO(generation, { outputs: [] });
      expect(dto).toEqual({
        id: generation.id,
        tool: 'text-to-image',
        kind: 'image',
        modelId: 'aivore-demo-image',
        prompt: 'a red fox in a snowy forest',
        params: { aspectRatio: '1:1', count: 1 },
        status: 'queued',
        progress: 0,
        cost: 1,
        outputs: [],
        isPublic: false,
        isFavorite: false,
        createdAt: generation.createdAt,
      });
      const json = JSON.stringify(dto);
      for (const secret of [
        'provider',
        'workerId',
        'leaseUntil',
        'attempts',
        'userId',
        'idempotency',
      ]) {
        expect(json).not.toContain(secret);
      }
    } finally {
      close();
    }
  });

  it('orders outputs by index, skips input assets and attaches the input image', () => {
    const { db, close } = createTestDb();
    try {
      const { user, generation } = fixture(db);
      const input = createAsset(db, { userId: user.id });
      const second = createAsset(db, {
        userId: user.id,
        generationId: generation.id,
        role: 'output',
        index: 1,
      });
      const first = createAsset(db, {
        userId: user.id,
        generationId: generation.id,
        role: 'output',
        index: 0,
      });
      const dto = toGenerationDTO(generation, { outputs: [second, input, first], input });
      expect(dto.outputs.map((output) => output.id)).toEqual([first.id, second.id]);
      expect(dto.input?.id).toBe(input.id);
    } finally {
      close();
    }
  });

  it('reports a failure with its code and message, and the timestamps', () => {
    const { db, close } = createTestDb();
    try {
      const user = createUser(db);
      const generation = createGeneration(db, {
        userId: user.id,
        status: 'failed',
        errorCode: 'provider_error',
        errorMessage: 'The generation service is temporarily unavailable.',
        startedAt: 10,
        finishedAt: 20,
        negativePrompt: 'blurry',
        isPublic: true,
        isFavorite: true,
        progress: 40,
      });
      const dto = toGenerationDTO(generation, { outputs: [] });
      expect(dto.error).toEqual({
        code: 'provider_error',
        message: 'The generation service is temporarily unavailable.',
      });
      expect(dto).toMatchObject({
        startedAt: 10,
        finishedAt: 20,
        negativePrompt: 'blurry',
        isPublic: true,
        isFavorite: true,
        progress: 40,
        status: 'failed',
      });
    } finally {
      close();
    }
  });

  it('adds only the owner display name, and only when asked', () => {
    const { db, close } = createTestDb();
    try {
      const { generation } = fixture(db);
      expect(toGenerationDTO(generation, { outputs: [] })).not.toHaveProperty('owner');
      const dto = toGenerationDTO(generation, { outputs: [], owner: { name: 'Layla' } });
      expect(dto.owner).toEqual({ name: 'Layla' });
    } finally {
      close();
    }
  });
});
