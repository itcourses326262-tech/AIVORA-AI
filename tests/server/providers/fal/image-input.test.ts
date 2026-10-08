import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ProviderError } from '@/server/providers/errors';
import {
  inputImageDataUri,
  prepareImage,
  targetSize,
  toDataUri,
} from '@/server/providers/fal/image-input';
import { inputFor, pngImage } from './fixtures';

const LOOSE = { maxSide: 4096, maxBytes: 10 * 1024 * 1024 };

async function noisyPng(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  let state = 123456789;
  for (let index = 0; index < raw.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    raw[index] = state >>> 24;
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

describe('targetSize', () => {
  it('returns undefined when the image already fits', () => {
    expect(targetSize(640, 480, { maxSide: 2048, maxBytes: 1 })).toBeUndefined();
  });

  it('scales down to the longest side and keeps the ratio', () => {
    expect(targetSize(4000, 2000, { maxSide: 2000, maxBytes: 1 })).toEqual({
      width: 2000,
      height: 1000,
    });
  });

  it('honours a pixel budget and rounds both sides down to the multiple', () => {
    const size = targetSize(2400, 1600, {
      maxSide: 2048,
      maxPixels: 1_000_000,
      multipleOf: 16,
      maxBytes: 1,
    });
    expect(size).toBeDefined();
    expect((size?.width ?? 0) * (size?.height ?? 0)).toBeLessThanOrEqual(1_000_000);
    expect((size?.width ?? 1) % 16).toBe(0);
    expect((size?.height ?? 1) % 16).toBe(0);
  });

  it('enlarges to the minimum side, but never past the longest allowed side', () => {
    expect(targetSize(200, 100, { maxSide: 2000, minSide: 360, maxBytes: 1 })).toEqual({
      width: 720,
      height: 360,
    });
    const extreme = targetSize(1000, 100, { maxSide: 1200, minSide: 360, maxBytes: 1 });
    expect(Math.max(extreme?.width ?? 0, extreme?.height ?? 0)).toBeLessThanOrEqual(1200);
  });
});

describe('prepareImage', () => {
  it('passes a conforming image through byte for byte', async () => {
    const bytes = await pngImage(320, 240);
    const result = await prepareImage({ bytes, mimeType: 'image/png' }, LOOSE);
    expect(result.bytes).toBe(bytes);
    expect(result.mimeType).toBe('image/png');
  });

  it('resizes an oversized image and re-encodes it as JPEG', async () => {
    const bytes = await pngImage(3000, 1500);
    const result = await prepareImage(
      { bytes, mimeType: 'image/png' },
      { maxSide: 1000, maxBytes: LOOSE.maxBytes },
    );
    expect(result.mimeType).toBe('image/jpeg');
    const meta = await sharp(result.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(500);
  });

  it('flattens transparency onto white only when the model needs an opaque image', async () => {
    const bytes = await pngImage(100, 100, { alpha: true });
    const kept = await prepareImage({ bytes, mimeType: 'image/png' }, LOOSE);
    expect(kept.bytes).toBe(bytes);
    const flat = await prepareImage({ bytes, mimeType: 'image/png' }, { ...LOOSE, opaque: true });
    expect((await sharp(flat.bytes).metadata()).hasAlpha).toBe(false);
  });

  it('shrinks until the encoded file fits the byte cap', async () => {
    const bytes = await noisyPng(900, 900);
    expect(bytes.byteLength).toBeGreaterThan(1_000_000);
    const result = await prepareImage(
      { bytes, mimeType: 'image/png' },
      { maxSide: 4096, maxBytes: 200_000 },
    );
    expect(result.bytes.byteLength).toBeLessThanOrEqual(200_000);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('fails with a user-safe invalid_input when it cannot reach the cap', async () => {
    const bytes = await noisyPng(512, 512);
    const error = await prepareImage(
      { bytes, mimeType: 'image/png' },
      { maxSide: 4096, maxBytes: 100 },
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('invalid_input');
    expect((error as ProviderError).retryable).toBe(false);
  });

  it('reports bytes that are not an image as invalid_input without echoing them', async () => {
    const error = await prepareImage(
      { bytes: new TextEncoder().encode('definitely not an image'), mimeType: 'image/png' },
      LOOSE,
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('invalid_input');
    expect((error as ProviderError).userMessage).not.toMatch(/definitely/);
  });
});

describe('data URIs', () => {
  it('encodes the exact bytes with their MIME type', () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(toDataUri({ bytes, mimeType: 'image/webp' })).toBe(
      `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`,
    );
  });

  it('inputImageDataUri refuses a request that has no image', async () => {
    const input = inputFor('fal-flux-dev-img2img');
    await expect(inputImageDataUri(input, LOOSE)).rejects.toMatchObject({
      code: 'invalid_input',
      retryable: false,
    });
  });
});
