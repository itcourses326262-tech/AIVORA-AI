import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import {
  MAX_UPLOAD_DIMENSION,
  makeThumbnail,
  normalizeUpload,
  probeImage,
} from '@/server/uploads/image';
import { TINY_GIF, TINY_PNG } from '../../helpers/fakes';
import {
  SVG,
  concat,
  fakeMp4,
  makeAnimatedGif,
  makeAnimatedWebp,
  makeApng,
  makeBombPng,
  makeDeclaredHugePng,
  makeJpeg,
  makePng,
  makeWebp,
  pixelAt,
  twoTone,
  utf8,
} from './support';

async function rejected(bytes: Uint8Array) {
  try {
    await normalizeUpload(bytes);
  } catch (error) {
    if (!isAppError(error)) throw error;
    return error;
  }
  throw new Error('expected normalizeUpload to reject');
}

const reasonOf = (error: { details?: unknown }) => (error.details as { reason?: string })?.reason;

describe('normalizeUpload: accepted images', () => {
  it.each([
    ['PNG', makePng, 'image/png', 'png'],
    ['JPEG', makeJpeg, 'image/jpeg', 'jpeg'],
    ['WebP', makeWebp, 'image/webp', 'webp'],
  ])('re-encodes a %s and keeps its type and size', async (_name, make, mimeType, format) => {
    const result = await normalizeUpload(await make(40, 20));
    expect(result.mimeType).toBe(mimeType);
    expect(result).toMatchObject({ width: 40, height: 20 });
    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    expect(meta.format).toBe(format);
    expect(meta).toMatchObject({ width: 40, height: 20 });
  });

  it('does not enlarge small images', async () => {
    expect(await normalizeUpload(await makePng(3, 2))).toMatchObject({ width: 3, height: 2 });
  });

  it('accepts a tiny valid PNG', async () => {
    expect(await normalizeUpload(TINY_PNG)).toMatchObject({ mimeType: 'image/png', width: 1 });
  });

  it('scales the longest side down to 4096 and keeps the aspect ratio', async () => {
    const wide = await normalizeUpload(await makePng(8192, 100));
    expect(wide).toMatchObject({ width: MAX_UPLOAD_DIMENSION, height: 50 });
    const tall = await normalizeUpload(await makeJpeg(100, 5000));
    expect(tall.height).toBe(MAX_UPLOAD_DIMENSION);
    expect(tall.width).toBe(82);
    const exact = await normalizeUpload(await makePng(4096, 10));
    expect(exact).toMatchObject({ width: 4096, height: 10 });
  });
});

describe('normalizeUpload: metadata', () => {
  it('strips EXIF (author, copyright, GPS) and every other metadata block', async () => {
    const original = await makeJpeg(40, 20, { exif: true });
    const originalMeta = await sharp(Buffer.from(original)).metadata();
    expect(originalMeta.exif).toBeDefined();
    expect(Buffer.from(original).includes('SECRET-ARTIST')).toBe(true);

    const { bytes } = await normalizeUpload(original);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(Buffer.from(bytes).includes('SECRET-')).toBe(false);
    expect(Buffer.from(bytes).includes('Exif')).toBe(false);
  });

  it('honours the EXIF orientation by rotating the pixels, then drops the tag', async () => {
    // Orientation 6: the stored picture must be turned 90 degrees clockwise to be shown upright.
    const original = await makeJpeg(40, 20, { orientation: 6 });
    expect((await sharp(Buffer.from(original)).metadata()).orientation).toBe(6);

    const result = await normalizeUpload(original);
    expect(result).toMatchObject({ width: 20, height: 40 });
    expect((await sharp(Buffer.from(result.bytes)).metadata()).orientation).toBeUndefined();
    // The red left half became the top half.
    const top = await pixelAt(result.bytes, 10, 5);
    const bottom = await pixelAt(result.bytes, 10, 35);
    expect(top[0]).toBeGreaterThan(200);
    expect(top[2]).toBeLessThan(60);
    expect(bottom[2]).toBeGreaterThan(200);
    expect(bottom[0]).toBeLessThan(60);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('applies EXIF orientation %i', async (orientation) => {
    const result = await normalizeUpload(await makeJpeg(40, 20, { orientation }));
    const swapped = orientation >= 5;
    expect(result).toMatchObject(swapped ? { width: 20, height: 40 } : { width: 40, height: 20 });
  });

  it('drops a payload hidden in a JPEG comment', async () => {
    const original = await makeJpeg(16, 16, { comment: '<?php system($_GET["c"]); ?>' });
    expect(Buffer.from(original).includes('<?php')).toBe(true);
    const { bytes } = await normalizeUpload(original);
    expect(Buffer.from(bytes).includes('<?php')).toBe(false);
  });
});

describe('normalizeUpload: refused files', () => {
  it.each([
    ['SVG', SVG],
    ['GIF', TINY_GIF],
    ['HTML', utf8('<html><script>alert(1)</script></html>')],
    ['an empty file', new Uint8Array(0)],
    ['MP4', fakeMp4()],
    ['random bytes', new Uint8Array(512).map((_, i) => (i * 7 + 3) & 0xff)],
  ])('refuses %s as an unsupported type', async (_name, bytes) => {
    const error = await rejected(bytes);
    expect(error.code).toBe('unsupported_media_type');
    expect(error.status).toBe(415);
  });

  it('refuses a PNG with a script appended (polyglot)', async () => {
    const error = await rejected(
      concat(await makePng(), utf8('<script>alert(document.cookie)</script>')),
    );
    expect(error.code).toBe('bad_request');
    expect(reasonOf(error)).toBe('trailing_data');
  });

  it('refuses a PNG with another file appended', async () => {
    const error = await rejected(concat(await makePng(), await makePng(4, 4)));
    expect(reasonOf(error)).toBe('trailing_data');
  });

  it('refuses a JPEG with HTML appended, but tolerates NUL padding', async () => {
    const jpeg = await makeJpeg();
    expect(reasonOf(await rejected(concat(jpeg, utf8('<html><script>x</script>'))))).toBe(
      'trailing_data',
    );
    expect((await normalizeUpload(concat(jpeg, new Uint8Array(16)))).mimeType).toBe('image/jpeg');
  });

  it('accepts a JPEG that carries a second picture (phone gain maps)', async () => {
    const result = await normalizeUpload(concat(await makeJpeg(), await makeJpeg(8, 8)));
    expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 32 });
  });

  it('refuses a WebP with data after the RIFF container', async () => {
    const error = await rejected(concat(await makeWebp(), utf8('PK\u0003\u0004 zip data')));
    expect(reasonOf(error)).toBe('trailing_data');
  });

  it.each([
    ['PNG', async () => (await makePng(64, 64)).slice(0, 60)],
    ['PNG in the pixel data', async () => (await makeBombPng(512, 512)).slice(0, 200)],
    ['JPEG', async () => (await makeJpeg(64, 64)).slice(0, 300)],
    ['JPEG header only', async () => (await makeJpeg(64, 64)).slice(0, 4)],
    ['WebP', async () => (await makeWebp(64, 64)).slice(0, 40)],
    ['WebP header only', async () => (await makeWebp(64, 64)).slice(0, 14)],
  ])('refuses a truncated %s', async (_name, make) => {
    const error = await rejected(await make());
    expect(error.code).toBe('bad_request');
    expect(['truncated', 'corrupt']).toContain(reasonOf(error));
  });

  it('refuses a file with a valid signature and garbage behind it', async () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (const signature of [
      png,
      [0xff, 0xd8, 0xff, 0xe0],
      [...utf8('RIFF'), 0, 0, 0, 0, ...utf8('WEBP')],
    ]) {
      const error = await rejected(
        concat(new Uint8Array(signature), utf8('not an image at all, just text')),
      );
      expect(error.code).toBe('bad_request');
    }
  });

  it('refuses an animated WebP', async () => {
    expect(reasonOf(await rejected(await makeAnimatedWebp()))).toBe('animated');
  });

  it('refuses an animated PNG (APNG)', async () => {
    expect(reasonOf(await rejected(await makeApng()))).toBe('animated');
  });

  it('refuses images with too many pixels, declared or real', async () => {
    const declared = await rejected(makeDeclaredHugePng(100_000, 100_000));
    expect(reasonOf(declared)).toBe('dimensions');
    const real = await makeBombPng(8000, 8000);
    expect(real.byteLength).toBeLessThan(1024 * 1024);
    expect(reasonOf(await rejected(real))).toBe('dimensions');
  });

  it('does not leak decoder messages to the client', async () => {
    const error = await rejected(concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), utf8('garbage')));
    expect(error.message).not.toMatch(/vips|jpeg|libjpeg|sharp/i);
  });
});

describe('probeImage', () => {
  it('reports the real format and size whatever the file claims', async () => {
    expect(await probeImage(await makeWebp(30, 10))).toEqual({
      width: 30,
      height: 10,
      mimeType: 'image/webp',
    });
    expect(await probeImage(TINY_GIF)).toMatchObject({ mimeType: 'image/gif', width: 1 });
  });

  it('reports displayed dimensions for rotated JPEGs', async () => {
    expect(await probeImage(await makeJpeg(40, 20, { orientation: 8 }))).toMatchObject({
      width: 20,
      height: 40,
    });
  });

  it('reads the first frame size of an animated GIF', async () => {
    expect(await probeImage(await makeAnimatedGif())).toMatchObject({ width: 12, height: 12 });
  });

  it('refuses formats a browser cannot show or that can carry scripts', async () => {
    for (const bytes of [SVG, utf8('%PDF-1.4 hello'), new Uint8Array([1, 2, 3])]) {
      const error = await probeImage(bytes).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe('bad_request');
    }
  });
});

describe('makeThumbnail', () => {
  it('makes a WebP of at most 512 px on the longest side', async () => {
    const source = new Uint8Array(await (await twoTone(1000, 500)).png().toBuffer());
    const thumb = await makeThumbnail(source);
    expect(thumb).toMatchObject({ width: 512, height: 256 });
    expect((await sharp(Buffer.from(thumb.bytes)).metadata()).format).toBe('webp');
    const tall = await makeThumbnail(await makeJpeg(100, 900));
    expect(tall).toMatchObject({ width: 57, height: 512 });
  });

  it('never enlarges', async () => {
    expect(await makeThumbnail(await makePng(40, 20))).toMatchObject({ width: 40, height: 20 });
  });

  it('uses the first frame of an animation and orients JPEGs', async () => {
    const gif = await makeThumbnail(await makeAnimatedGif(4));
    const [r, g] = await pixelAt(gif.bytes, 5, 5);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(await makeThumbnail(await makeJpeg(40, 20, { orientation: 6 }))).toMatchObject({
      width: 20,
      height: 40,
    });
  });

  it('refuses things that are not images', async () => {
    const error = await makeThumbnail(utf8('definitely not an image')).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe('bad_request');
  });
});

describe('normalizeUpload: well-formed variants are not rejected', () => {
  const base = async () => twoTone(64, 48);

  it.each([
    ['progressive JPEG', async () => (await base()).jpeg({ progressive: true })],
    ['mozjpeg JPEG', async () => (await base()).jpeg({ mozjpeg: true })],
    ['4:4:4 JPEG', async () => (await base()).jpeg({ chromaSubsampling: '4:4:4' })],
    ['grayscale JPEG', async () => (await base()).greyscale().jpeg()],
    ['interlaced PNG', async () => (await base()).png({ progressive: true })],
    ['palette PNG', async () => (await base()).png({ palette: true })],
    ['PNG with alpha', async () => (await base()).ensureAlpha(0.5).png()],
    ['lossless WebP', async () => (await base()).webp({ lossless: true })],
    ['WebP with alpha (VP8X, not animated)', async () => (await base()).ensureAlpha(0.5).webp()],
  ])('accepts a %s', async (_name, build) => {
    const bytes = new Uint8Array(await (await build()).toBuffer());
    const result = await normalizeUpload(bytes);
    expect(result).toMatchObject({ width: 64, height: 48 });
  });

  it('accepts a large photo-sized JPEG quickly', async () => {
    const photo = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#336699' },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
    const started = performance.now();
    const result = await normalizeUpload(new Uint8Array(photo));
    expect(result).toMatchObject({ width: 4000, height: 3000 });
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
