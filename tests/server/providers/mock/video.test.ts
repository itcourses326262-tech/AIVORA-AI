import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/server/providers/errors';
import { mockProvider } from '@/server/providers/mock';
import { renderImageVideoFrames } from '@/server/providers/mock/video/ken-burns';
import { encodeGif } from '@/server/providers/mock/video/gif';
import { frameCountFor } from '@/server/providers/mock/video/pace';
import { renderTextVideoFrames } from '@/server/providers/mock/video/text-scene';
import { videoSizeForRatio } from '@/server/providers/mock/size';
import { parseGif } from './gif';
import {
  captureContext,
  forbidNetwork,
  generate,
  makeTestImage,
  mockInput,
  useFakeClock,
} from './fixtures';

beforeEach(() => {
  useFakeClock();
  forbidNetwork();
});
afterEach(() => vi.useRealTimers());

const gifOf = (output: { bytes?: Uint8Array }) => output.bytes as Uint8Array;

/** Mean absolute difference between two RGBA frames, in colour levels. */
function difference(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 4) {
    total +=
      Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  }
  return total / ((a.length / 4) * 3);
}

describe('frame counts', () => {
  it('is ten frames per second of video, between 12 and 30', () => {
    expect(frameCountFor(1)).toBe(12);
    expect(frameCountFor(3)).toBe(30);
    expect(frameCountFor(5)).toBe(30);
    expect(frameCountFor(60)).toBe(30);
  });
});

describe('text-to-video through the provider', () => {
  it('returns a valid looping animated GIF in the requested ratio', async () => {
    const [output] = await generate(mockInput('text-to-video'));
    const expected = videoSizeForRatio('16:9');
    expect(output).toMatchObject({
      kind: 'video',
      mimeType: 'image/gif',
      durationMs: 3000,
      seed: 7,
      ...expected,
    });
    const bytes = gifOf(output!);
    expect(Buffer.from(bytes.subarray(0, 6)).toString('latin1')).toBe('GIF89a');

    const gif = parseGif(bytes);
    expect(gif).toMatchObject({ width: expected.width, height: expected.height, loopCount: 0 });
    expect(gif.frameCount).toBe(30);
    expect(gif.frameCount).toBeLessThanOrEqual(30);
    expect(Math.max(gif.width, gif.height)).toBeLessThanOrEqual(480);
    expect(gif.hasGlobalColorTable).toBe(true);
    expect(gif.globalColorTableSize).toBe(256);
    expect(gif.localColorTables).toBe(0);
    expect(gif.endsWithTrailer).toBe(true);
    expect(gif.delaysMs).toHaveLength(30);
    expect(gif.delaysMs.reduce((sum, delay) => sum + delay, 0)).toBeCloseTo(3000, -2);

    // An independent decoder agrees: sharp stacks the pages of an animated GIF.
    const meta = await sharp(Buffer.from(bytes), { animated: true }).metadata();
    expect(meta).toMatchObject({ format: 'gif', pages: 30, width: expected.width, loop: 0 });
    expect(meta.pageHeight).toBe(expected.height);
  }, 30_000);

  it('is deterministic end to end', async () => {
    const [first] = await generate(mockInput('text-to-video'));
    const [second] = await generate(mockInput('text-to-video'));
    expect(Buffer.from(gifOf(first!)).equals(Buffer.from(gifOf(second!)))).toBe(true);
  }, 30_000);

  it('keeps a 5 second portrait clip small, and the resolution only changes the price', async () => {
    const input = mockInput('text-to-video');
    const params = {
      ...input.params,
      aspectRatio: '9:16',
      durationSec: 5,
      resolution: '720p',
    } as const;
    const [output] = await generate({ ...input, params });
    const gif = parseGif(gifOf(output!));
    expect(output).toMatchObject({ width: 270, height: 480, durationMs: 5000 });
    expect(gif).toMatchObject({ width: 270, height: 480 });
    expect(gif.frameCount).toBeLessThanOrEqual(30);
    expect(gif.delaysMs.reduce((sum, delay) => sum + delay, 0)).toBeGreaterThan(4800);
    expect(gif.delaysMs.reduce((sum, delay) => sum + delay, 0)).toBeLessThan(5400);
    expect(gifOf(output!).byteLength).toBeLessThan(6_000_000);

    const cheap = await generate({ ...input, params: { ...params, resolution: '480p' } });
    expect(Buffer.from(gifOf(cheap[0]!)).equals(Buffer.from(gifOf(output!)))).toBe(true);
  }, 30_000);

  it('falls back to the model default duration when none is given', async () => {
    const input = mockInput('text-to-video');
    const { durationSec: _duration, ...params } = input.params;
    const [output] = await generate({ ...input, params });
    expect(output?.durationMs).toBe(3000);
  }, 30_000);
});

describe('text scene frames', () => {
  const request = { prompt: 'calm ocean at sunset', seed: 3, width: 96, height: 54, frames: 12 };

  it('differs per seed and per prompt, and repeats for the same request', async () => {
    const base = await renderTextVideoFrames(request);
    const again = await renderTextVideoFrames(request);
    const otherSeed = await renderTextVideoFrames({ ...request, seed: 4 });
    const otherPrompt = await renderTextVideoFrames({ ...request, prompt: 'neon city' });
    expect(base).toHaveLength(12);
    expect(base[5]).toEqual(again[5]);
    expect(difference(base[5]!, otherSeed[5]!)).toBeGreaterThan(5);
    expect(difference(base[5]!, otherPrompt[5]!)).toBeGreaterThan(5);
  });

  it('moves, but loops without a jump from the last frame back to the first', async () => {
    const frames = await renderTextVideoFrames({ ...request, frames: 30 });
    const steps = frames.slice(1).map((frame, i) => difference(frames[i]!, frame));
    const closing = difference(frames[29]!, frames[0]!);
    const typical = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    expect(typical).toBeGreaterThan(0.5);
    expect(difference(frames[0]!, frames[15]!)).toBeGreaterThan(typical * 2);
    expect(closing).toBeLessThan(Math.max(...steps) * 1.15);
  });

  it('gives every frame its own buffer of exactly width x height RGBA, fully opaque', async () => {
    const frames = await renderTextVideoFrames(request);
    for (const frame of frames) {
      expect(frame.byteLength).toBe(96 * 54 * 4);
      expect(frame.buffer.byteLength).toBe(frame.byteLength);
      for (let i = 3; i < frame.length; i += 4) {
        if (frame[i] !== 255) throw new Error('translucent pixel');
      }
    }
  });

  it('stops rendering as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const rendering = renderTextVideoFrames({ ...request, signal: controller.signal });
    controller.abort(new Error('canceled'));
    await expect(rendering).rejects.toThrow('canceled');
  });
});

describe('image-to-video', () => {
  it('animates the input, keeps its proportions and returns a valid GIF', async () => {
    const input = mockInput('image-to-video', {
      inputImage: { bytes: await makeTestImage(800, 600), mimeType: 'image/png' },
    });
    const [output] = await generate(input);
    expect(output).toMatchObject({
      kind: 'video',
      mimeType: 'image/gif',
      width: 480,
      height: 360,
      durationMs: 3000,
    });
    const gif = parseGif(gifOf(output!));
    expect(gif).toMatchObject({ width: 480, height: 360, loopCount: 0, endsWithTrailer: true });
    expect(gif.frameCount).toBe(30);
    expect((await sharp(Buffer.from(gifOf(output!)), { animated: true }).metadata()).pages).toBe(
      30,
    );
  }, 30_000);

  it('follows the input proportions whatever aspect ratio the request names', async () => {
    const portrait = await makeTestImage(300, 600, 'jpeg');
    const input = mockInput('image-to-video', {
      inputImage: { bytes: portrait, mimeType: 'image/jpeg' },
    });
    const [output] = await generate({
      ...input,
      params: { ...input.params, aspectRatio: '21:9' },
    });
    expect(output).toMatchObject({ width: 240, height: 480 });
    expect(parseGif(gifOf(output!))).toMatchObject({ width: 240, height: 480 });
  }, 30_000);

  it('is deterministic, moves, and loops without a jump', async () => {
    const bytes = await makeTestImage(320, 180, 'webp');
    const first = await renderImageVideoFrames({ imageBytes: bytes, seed: 9, frames: 30 });
    const second = await renderImageVideoFrames({ imageBytes: bytes, seed: 9, frames: 30 });
    const other = await renderImageVideoFrames({ imageBytes: bytes, seed: 10, frames: 30 });
    expect(first.frames[7]).toEqual(second.frames[7]);
    expect(difference(first.frames[7]!, other.frames[7]!)).toBeGreaterThan(0.3);

    const steps = first.frames.slice(1).map((frame, i) => difference(first.frames[i]!, frame));
    const closing = difference(first.frames[29]!, first.frames[0]!);
    expect(difference(first.frames[0]!, first.frames[15]!)).toBeGreaterThan(2);
    expect(closing).toBeLessThan(Math.max(...steps) * 1.15);
  });

  it('is gentle: no frame is a copy of the still, and none strays far from it', async () => {
    const bytes = await makeTestImage(320, 180);
    const clip = await renderImageVideoFrames({ imageBytes: bytes, seed: 2, frames: 30 });
    const still = await sharp(Buffer.from(bytes))
      .resize(clip.width, clip.height)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const stillRgba = new Uint8Array(still.buffer, still.byteOffset, still.byteLength);
    const gaps = clip.frames.map((frame) => difference(frame, stillRgba));
    expect(Math.max(...gaps)).toBeLessThan(60);
    expect(Math.max(...gaps)).toBeGreaterThan(1);
  });

  it('accepts tiny and transparent inputs', async () => {
    const tiny = await renderImageVideoFrames({
      imageBytes: await makeTestImage(1, 1),
      seed: 1,
      frames: 12,
    });
    expect(tiny).toMatchObject({ width: 480, height: 480 });
    const transparent = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.3 },
      },
    })
      .png()
      .toBuffer();
    const clip = await renderImageVideoFrames({ imageBytes: transparent, seed: 1, frames: 12 });
    expect(clip.frames).toHaveLength(12);
  });

  it('rejects bytes that are not an image as a non-retryable invalid_input', async () => {
    const garbage = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const failure = await renderImageVideoFrames({
      imageBytes: garbage,
      seed: 1,
      frames: 12,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ code: 'invalid_input', retryable: false });
    expect((failure as ProviderError).userMessage).not.toMatch(/Error:|at /);
  });

  it('refuses to start without an input image', async () => {
    await expect(
      mockProvider.submit(mockInput('image-to-video'), captureContext().context),
    ).rejects.toMatchObject({ code: 'invalid_input', retryable: false });
  });
});

describe('GIF encoder', () => {
  it('writes one shared palette and exactly the frames it is given', async () => {
    const width = 16;
    const height = 12;
    const frames = Array.from({ length: 4 }, (_, i) => {
      const rgba = new Uint8Array(width * height * 4);
      for (let p = 0; p < width * height; p++) {
        rgba.set([(p * 7 + i * 60) % 256, (p * 3) % 256, 200 - i * 40, 255], p * 4);
      }
      return rgba;
    });
    const bytes = await encodeGif({ frames, width, height, delayMs: 120, dither: 8 });
    expect(parseGif(bytes)).toMatchObject({
      width,
      height,
      frameCount: 4,
      loopCount: 0,
      localColorTables: 0,
      delaysMs: [120, 120, 120, 120],
      endsWithTrailer: true,
    });
  });

  it('does not read past a frame that lives inside a larger buffer', async () => {
    const width = 8;
    const height = 8;
    const slab = new Uint8Array(width * height * 4 + 256).fill(0x7f);
    const view = slab.subarray(64, 64 + width * height * 4);
    for (let p = 0; p < width * height; p++) view.set([255, 0, 0, 255], p * 4);
    const gif = await encodeGif({ frames: [view], width, height, delayMs: 100, dither: 0 });
    const { data, info } = await sharp(Buffer.from(gif))
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let p = 0; p < width * height; p++) {
      const o = p * info.channels;
      expect(data[o]).toBeGreaterThan(240);
      expect(data[o + 1]).toBeLessThan(16);
      expect(data[o + 2]).toBeLessThan(16);
    }
  });
});

describe('performance budget', () => {
  it('renders a 5 second clip in well under 3 seconds of CPU time, text and image alike', async () => {
    const budgetMs = 3000;
    const measure = async (run: () => Promise<unknown>) => {
      const before = process.cpuUsage();
      await run();
      const used = process.cpuUsage(before);
      return (used.user + used.system) / 1000;
    };
    const text = mockInput('text-to-video');
    const textCpu = await measure(() =>
      generate({ ...text, params: { ...text.params, aspectRatio: '1:1', durationSec: 5 } }),
    );
    const image = mockInput('image-to-video', {
      inputImage: { bytes: await makeTestImage(1920, 1080, 'jpeg'), mimeType: 'image/jpeg' },
    });
    const imageCpu = await measure(() =>
      generate({ ...image, params: { ...image.params, durationSec: 5 } }),
    );
    expect(textCpu).toBeLessThan(budgetMs);
    expect(imageCpu).toBeLessThan(budgetMs);
  }, 60_000);

  it('keeps memory bounded: at most thirty small frames are held at once', async () => {
    const { width, height } = videoSizeForRatio('1:1');
    const frames = await renderTextVideoFrames({
      prompt: 'bounded',
      seed: 1,
      width,
      height,
      frames: frameCountFor(5),
    });
    const bytes = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
    expect(frames.length).toBeLessThanOrEqual(30);
    expect(bytes).toBeLessThan(32 * 1024 * 1024);
  }, 30_000);

  it('keeps the event loop responsive while it renders', async () => {
    vi.useRealTimers();
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 5);
    let longestGap = 0;
    let last = performance.now();
    const probe = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last);
      last = now;
    }, 5);
    const input = mockInput('text-to-video');
    const submitted = await mockProvider.submit(
      {
        ...input,
        prompt: `${input.prompt} __sync__`,
        params: { ...input.params, aspectRatio: '1:1' },
      },
      captureContext().context,
    );
    clearInterval(timer);
    clearInterval(probe);
    expect(submitted.mode).toBe('sync');
    expect(ticks).toBeGreaterThan(10);
    expect(longestGap).toBeLessThan(500);
  }, 30_000);
});
