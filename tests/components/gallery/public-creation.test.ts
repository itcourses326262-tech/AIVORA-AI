import { describe, expect, it } from 'vitest';
import { firstNameOf, toPublicCreation } from '@/components/gallery/public-creation';
import { assetDTO, generationDTO } from '../generations/support';

describe('firstNameOf', () => {
  it('keeps only the first word of the account name', () => {
    expect(firstNameOf('Layla Hassan')).toBe('Layla');
    expect(firstNameOf('  ليلى   حسن العلي ')).toBe('ليلى');
    expect(firstNameOf('Madonna')).toBe('Madonna');
  });

  it('is null when there is no usable name', () => {
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
    expect(firstNameOf('\u200b\u200f')).toBeNull();
  });

  it('never lets an email address or a link stand in for a name', () => {
    expect(firstNameOf('layla@example.com')).toBeNull();
    expect(firstNameOf('layla@example.com Hassan')).toBeNull();
    expect(firstNameOf('https://evil.example/x')).toBeNull();
    expect(firstNameOf('a\\b')).toBeNull();
  });

  it('cuts an absurdly long first word and strips direction marks', () => {
    expect(Array.from(firstNameOf('x'.repeat(100)) ?? '')).toHaveLength(24);
    expect(firstNameOf('\u200fليلى\u200e Hassan')).toBe('ليلى');
  });
});

describe('toPublicCreation', () => {
  const generation = generationDTO({
    prompt: 'A lone lighthouse',
    negativePrompt: 'blurry',
    cost: 7,
    isFavorite: true,
    isPublic: true,
    params: {
      aspectRatio: '16:9',
      count: 2,
      seed: 4242,
      strength: 0.7,
      durationSec: 5,
      resolution: '720p',
    },
    owner: { name: 'Layla Hassan' },
    input: assetDTO({ id: 'ast_input' }),
    outputs: [assetDTO({ id: 'ast_a' }), assetDTO({ id: 'ast_b' })],
    startedAt: 1,
    finishedAt: 2,
  });

  it('keeps what the public pages show and the first name of the owner', () => {
    const creation = toPublicCreation(generation);
    expect(creation).toMatchObject({
      id: generation.id,
      prompt: 'A lone lighthouse',
      modelId: generation.modelId,
      ownerFirstName: 'Layla',
      params: { aspectRatio: '16:9', durationSec: 5, resolution: '720p' },
    });
    expect(creation.outputs.map((output) => output.id)).toEqual(['ast_a', 'ast_b']);
  });

  it('drops everything private: seed, strength, cost, favorite flag, input picture, full name', () => {
    const text = JSON.stringify(toPublicCreation(generation));
    for (const secret of [
      '4242',
      'Hassan',
      'ast_input',
      '"cost"',
      'isFavorite',
      'strength',
      'seed',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('has no owner when the feed did not name one', () => {
    expect(toPublicCreation(generationDTO()).ownerFirstName).toBeNull();
  });

  it('never carries the negative prompt, even when the DTO has one', () => {
    expect('negativePrompt' in toPublicCreation(generation)).toBe(false);
    expect('negativePrompt' in toPublicCreation(generationDTO())).toBe(false);
  });
});
