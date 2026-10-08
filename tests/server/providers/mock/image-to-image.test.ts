import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/server/providers/errors';
import { effectiveStrength, transformImage } from '@/server/providers/mock/image/transform';
import { IMAGE_PIXEL_BUDGET } from '@/server/providers/mock/size';
import { forbidNetwork, generate, makeTestImage, mockInput, useFakeClock } from './fixtures';

// These tests really render pictures and clips; a loaded CI runner needs far more than the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  useFakeClock();
  forbidNetwork();
});
afterEach(() => vi.useRealTimers());

async function pixels(bytes: Uint8Array, width: number, height: number) {
  const { data } = await sharp(Buffer.from(bytes))
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/** Mean absolute difference per channel between the input and the result, at the result's size. */
async function changeFrom(
  input: Uint8Array,
  output: { bytes: Uint8Array; width: number; height: number },
) {
  const [before, after] = await Promise.all([
    pixels(input, output.width, output.height),
    pixels(output.bytes, output.width, output.height),
  ]);
  let total = 0;
  for (let i = 0; i < before.length; i++) total += Math.abs(before[i]! - after[i]!);
  return total / before.length;
}

const PROMPT = 'make it dreamy';

describe('image-to-image transform', () => {
  it('is deterministic and never returns the input unchanged', async () => {
    const input = await makeTestImage(640, 480);
    const request = { imageBytes: input, prompt: PROMPT, seed: 11, strength: 0.6 };
    const first = await transformImage(request);
    const second = await transformImage(request);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(Buffer.from(input).equals(first.bytes)).toBe(false);
    expect(await changeFrom(input, first)).toBeGreaterThan(8);
  });

  it.each([
    [800, 600],
    [600, 900],
    [1000, 120],
    [333, 777],
  ] as const)('keeps the aspect ratio of a %ix%i input (and its size when small)', async (w, h) => {
    const input = await makeTestImage(w, h, 'jpeg');
    const result = await transformImage({
      imageBytes: input,
      prompt: PROMPT,
      seed: 3,
      strength: 0.7,
    });
    expect(result).toMatchObject({ width: w, height: h });
    expect(await sharp(result.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: w,
      height: h,
    });
  });

  it('shrinks a large input to about one megapixel, keeping its aspect ratio', async () => {
    const input = await makeTestImage(2400, 1600, 'jpeg');
    const result = await transformImage({
      imageBytes: input,
      prompt: PROMPT,
      seed: 3,
      strength: 0.7,
    });
    expect(result.width * result.height).toBeLessThanOrEqual(IMAGE_PIXEL_BUDGET);
    expect(result.width * result.height).toBeGreaterThan(IMAGE_PIXEL_BUDGET * 0.97);
    expect(result.width / result.height).toBeCloseTo(1.5, 2);
  });

  it('never enlarges a small input', async () => {
    const result = await transformImage({
      imageBytes: await makeTestImage(100, 60),
      prompt: PROMPT,
      seed: 1,
      strength: 1,
    });
    expect(result).toMatchObject({ width: 100, height: 60 });
  });

  it('moves further from the input as strength grows', async () => {
    const input = await makeTestImage(480, 320);
    for (const seed of [1, 2, 3, 4]) {
      const changes: number[] = [];
      for (const strength of [0.15, 0.5, 1]) {
        const result = await transformImage({ imageBytes: input, prompt: PROMPT, seed, strength });
        changes.push(await changeFrom(input, result));
      }
      expect(changes[0], `seed ${seed}`).toBeLessThan(changes[1]!);
      expect(changes[1], `seed ${seed}`).toBeLessThan(changes[2]!);
    }
  });

  it('defaults to 0.6 and clamps strength to 0.1 .. 1', async () => {
    expect(effectiveStrength(undefined)).toBe(0.6);
    expect(effectiveStrength(Number.NaN)).toBe(0.6);
    expect(effectiveStrength(0)).toBe(0.1);
    expect(effectiveStrength(-3)).toBe(0.1);
    expect(effectiveStrength(7)).toBe(1);

    const input = await makeTestImage(200, 150);
    const render = (strength?: number) =>
      transformImage({
        imageBytes: input,
        prompt: PROMPT,
        seed: 5,
        ...(strength === undefined ? {} : { strength }),
      });
    expect((await render()).bytes.equals((await render(0.6)).bytes)).toBe(true);
    expect((await render(0)).bytes.equals((await render(0.1)).bytes)).toBe(true);
    expect((await render(9)).bytes.equals((await render(1)).bytes)).toBe(true);
  });

  it('differs per seed and per prompt', async () => {
    const input = await makeTestImage(200, 150);
    const base = await transformImage({
      imageBytes: input,
      prompt: PROMPT,
      seed: 1,
      strength: 0.8,
    });
    const seeds = await transformImage({
      imageBytes: input,
      prompt: PROMPT,
      seed: 2,
      strength: 0.8,
    });
    const prompts = await transformImage({
      imageBytes: input,
      prompt: 'a calm ocean',
      seed: 1,
      strength: 0.8,
    });
    expect(base.bytes.equals(seeds.bytes)).toBe(false);
    expect(base.bytes.equals(prompts.bytes)).toBe(false);
  });

  it('keeps transparency where the input had it', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4, 200);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) raw[(y * width + x) * 4 + 3] = x < width / 2 ? 0 : 255;
    }
    const input = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const result = await transformImage({
      imageBytes: input,
      prompt: PROMPT,
      seed: 1,
      strength: 0.8,
    });
    const { data, info } = await sharp(result.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[(10 * width + 5) * 4 + 3]).toBeLessThan(16);
    expect(data[(10 * width + 60) * 4 + 3]).toBeGreaterThan(240);
  });

  it('honours the EXIF orientation of a photo', async () => {
    const upright = await sharp(Buffer.from(await makeTestImage(300, 200, 'jpeg')))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await transformImage({
      imageBytes: upright,
      prompt: PROMPT,
      seed: 1,
      strength: 0.5,
    });
    expect(result).toMatchObject({ width: 200, height: 300 });
  });

  it('rejects bytes that are not an image as a non-retryable invalid_input', async () => {
    const failure = await transformImage({
      imageBytes: Uint8Array.from([0, 1, 2, 3]),
      prompt: PROMPT,
      seed: 1,
      strength: 0.5,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ code: 'invalid_input', retryable: false });
  });

  it('refuses decompression bombs before decoding them', async () => {
    // A PNG that claims 20000 x 20000 pixels (400 MP) but carries next to no pixel data.
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      body.copy(out, 4);
      out.writeUInt32BE(crc32(body), 8 + data.length);
      return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(20_000, 0);
    header.writeUInt32BE(20_000, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.alloc(1))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const failure = await transformImage({
      imageBytes: bomb,
      prompt: PROMPT,
      seed: 1,
      strength: 0.5,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'invalid_input' });
    expect(String((failure as ProviderError).cause)).toMatch(/pixel limit/);
  });
});

describe('image-to-image through the provider', () => {
  it('returns `count` edited images that share the input proportions', async () => {
    const bytes = await makeTestImage(640, 400);
    const input = mockInput('image-to-image', {
      inputImage: { bytes, mimeType: 'image/png', width: 640, height: 400 },
    });
    const outputs = await generate({
      ...input,
      params: { ...input.params, count: 2, strength: 0.7, seed: 50 },
    });
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({
      kind: 'image',
      mimeType: 'image/webp',
      width: 640,
      height: 400,
      seed: 50,
    });
    expect(outputs[1]?.seed).not.toBe(50);
    expect(Buffer.from(outputs[0]!.bytes!).equals(Buffer.from(outputs[1]!.bytes!))).toBe(false);
    for (const output of outputs) {
      expect(
        await changeFrom(bytes, output as { bytes: Uint8Array; width: number; height: number }),
      ).toBeGreaterThan(5);
    }
  });

  it('ignores the requested aspect ratio: the input decides', async () => {
    const input = mockInput('image-to-image', {
      inputImage: { bytes: await makeTestImage(300, 500), mimeType: 'image/png' },
    });
    const [output] = await generate({
      ...input,
      params: { ...input.params, aspectRatio: '16:9' },
    });
    expect(output).toMatchObject({ width: 300, height: 500 });
  });

  it('refuses to start without an input image', async () => {
    const { mockProvider } = await import('@/server/providers/mock');
    const { captureContext } = await import('./fixtures');
    await expect(
      mockProvider.submit(mockInput('image-to-image'), captureContext().context),
    ).rejects.toMatchObject({ code: 'invalid_input', retryable: false });
  });
});
