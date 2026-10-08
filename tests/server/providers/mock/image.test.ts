import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderArtwork } from '@/server/providers/mock/image/art';
import { clampImageCount, resolveSeed } from '@/server/providers/mock/outputs';
import { mockImageSize } from '@/server/providers/mock/size';
import { IMAGE_MODEL, forbidNetwork, generate, mockInput, useFakeClock } from './fixtures';

// These tests really render pictures and clips; a loaded CI runner needs far more than the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  useFakeClock();
  forbidNetwork();
});
afterEach(() => vi.useRealTimers());

const bytesOf = (output: { bytes?: Uint8Array }) => Buffer.from(output.bytes as Uint8Array);

// The artwork itself is a pure function; small canvases keep these checks quick.
const SMALL = { width: 320, height: 320 } as const;

async function meanColour(bytes: Buffer) {
  const { channels } = await sharp(bytes).stats();
  return { r: channels[0]!.mean, g: channels[1]!.mean, b: channels[2]!.mean };
}

describe('artwork (pure rendering)', () => {
  it('is deterministic: the same request gives the same bytes', async () => {
    const request = { prompt: 'a calm lake at dawn', seed: 7, ...SMALL };
    const [first, second] = await Promise.all([renderArtwork(request), renderArtwork(request)]);
    expect(first.equals(second)).toBe(true);
  });

  it('changes with the prompt, the seed and the negative prompt', async () => {
    const base = { prompt: 'a calm lake at dawn', seed: 7, ...SMALL };
    const reference = await renderArtwork(base);
    const variants = [
      { ...base, prompt: 'a bustling market square' },
      { ...base, seed: 8 },
      { ...base, negativePrompt: 'blurry, low quality' },
    ];
    for (const variant of variants) {
      expect((await renderArtwork(variant)).equals(reference)).toBe(false);
    }
  });

  it('draws at the requested size and nothing else', async () => {
    for (const [width, height] of [
      [320, 180],
      [180, 320],
      [64, 64],
    ] as const) {
      const bytes = await renderArtwork({ prompt: 'x', seed: 1, width, height });
      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width, height });
    }
  });

  it('paints varied artwork rather than a flat fill, across many seeds', async () => {
    for (let seed = 0; seed < 12; seed++) {
      const bytes = await renderArtwork({ prompt: 'abstract art', seed, ...SMALL });
      const { channels } = await sharp(bytes).stats();
      const spread = channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
      expect(spread, `seed ${seed}`).toBeGreaterThan(10);
      const mean = channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
      expect(mean, `seed ${seed}`).toBeGreaterThan(15);
      expect(mean, `seed ${seed}`).toBeLessThan(240);
    }
  });

  it('lets words in the prompt (English or Arabic) steer the colours', async () => {
    const warmth = async (prompt: string) => {
      let red = 0;
      let blue = 0;
      for (const seed of [1, 2, 3, 4]) {
        const mean = await meanColour(await renderArtwork({ prompt, seed, ...SMALL }));
        red += mean.r;
        blue += mean.b;
      }
      return { red, blue };
    };
    const ocean = await warmth('a calm ocean at night');
    const arabicOcean = await warmth('بحر هادئ في الليل');
    const desert = await warmth('golden desert dunes under the sun');
    expect(ocean.blue).toBeGreaterThan(ocean.red);
    expect(arabicOcean.blue).toBeGreaterThan(arabicOcean.red);
    expect(desert.red).toBeGreaterThan(desert.blue);
  });

  it('copes with empty, very long and emoji prompts', async () => {
    for (const prompt of ['', 'x'.repeat(5000), '🌅🌊 مرحبا 你好', '\u0000‮']) {
      const bytes = await renderArtwork({ prompt, seed: 3, ...SMALL });
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  });

  it('keeps every composition within the canvas for extreme ratios', async () => {
    for (const [width, height] of [
      [1512, 648],
      [200, 1000],
    ] as const) {
      const bytes = await renderArtwork({ prompt: 'galaxy', seed: 5, width, height });
      expect(await sharp(bytes).metadata()).toMatchObject({ width, height });
    }
  });
});

describe('text-to-image through the provider', () => {
  it('is deterministic end to end and ignores trigger words in the artwork', async () => {
    const [first] = await generate(mockInput('text-to-image'));
    const [second] = await generate(mockInput('text-to-image'));
    const [synced] = await generate(
      mockInput('text-to-image', { prompt: 'a calm lake at dawn __SYNC__' }),
    );
    expect(first?.bytes).toBeDefined();
    expect(bytesOf(first!).equals(bytesOf(second!))).toBe(true);
    expect(bytesOf(first!).equals(bytesOf(synced!))).toBe(true);
  }, 20_000);

  it.each(IMAGE_MODEL.limits.aspectRatios)(
    'renders %s at about one megapixel in exactly that ratio',
    async (aspectRatio) => {
      const input = mockInput('text-to-image');
      const [output] = await generate({ ...input, params: { ...input.params, aspectRatio } });
      const expected = mockImageSize(aspectRatio);
      expect(output).toMatchObject({ kind: 'image', mimeType: 'image/webp', ...expected });
      expect(await sharp(bytesOf(output!)).metadata()).toMatchObject({
        format: 'webp',
        ...expected,
      });
      expect(expected.width * expected.height).toBeLessThanOrEqual(1024 * 1024);
      expect(expected.width * expected.height).toBeGreaterThan(900_000);
      expect(bytesOf(output!).length).toBeLessThan(1_500_000);
    },
    20_000,
  );

  it('produces `count` images, each with its own sub-seed and its own picture', async () => {
    const input = mockInput('text-to-image');
    const outputs = await generate({ ...input, params: { ...input.params, count: 3, seed: 1000 } });
    expect(outputs).toHaveLength(3);
    expect(outputs[0]?.seed).toBe(1000);
    expect(new Set(outputs.map((output) => output.seed)).size).toBe(3);
    expect(new Set(outputs.map((output) => bytesOf(output).toString('base64'))).size).toBe(3);

    // The seed echoed for image 2 reproduces exactly that picture on its own.
    const [alone] = await generate({
      ...input,
      params: { ...input.params, count: 1, seed: outputs[2]!.seed },
    });
    expect(bytesOf(alone!).equals(bytesOf(outputs[2]!))).toBe(true);
  }, 30_000);

  it('echoes the requested seed in the output', async () => {
    const input = mockInput('text-to-image');
    const [seeded] = await generate({ ...input, params: { ...input.params, seed: 42 } });
    expect(seeded?.seed).toBe(42);
  }, 20_000);
});

describe('request normalisation', () => {
  it('caps the count at four and treats a nonsense count as one', () => {
    expect(clampImageCount(3)).toBe(3);
    expect(clampImageCount(9)).toBe(4);
    expect(clampImageCount(0)).toBe(1);
    expect(clampImageCount(-2)).toBe(1);
    expect(clampImageCount(2.9)).toBe(2);
    expect(clampImageCount(Number.NaN)).toBe(1);
  });

  it('uses the requested seed, or a stable one derived from the generation id', () => {
    const input = mockInput('text-to-image');
    const { seed: _seed, ...withoutSeed } = input.params;
    expect(resolveSeed({ ...input, params: { ...input.params, seed: 42 } })).toBe(42);
    expect(resolveSeed({ ...input, params: { ...input.params, seed: -1 } })).toBe(0xffff_ffff);
    const a = resolveSeed({ ...input, generationId: 'gen_a', params: withoutSeed });
    expect(Number.isInteger(a)).toBe(true);
    expect(resolveSeed({ ...input, generationId: 'gen_a', params: withoutSeed })).toBe(a);
    expect(resolveSeed({ ...input, generationId: 'gen_b', params: withoutSeed })).not.toBe(a);
  });
});
