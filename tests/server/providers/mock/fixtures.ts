import sharp from 'sharp';
import { vi } from 'vitest';
import { fakeProviderContext } from '../../../helpers/fakes';
import { getEnv } from '@/server/env';
import { createLogger } from '@/server/logger';
import type { GenerationParams, ModelSpec, Tool } from '@/lib/catalog/types';
import { mockModels } from '@/lib/catalog/models/mock';
import type { ProviderContext, ProviderInput } from '@/server/providers/types';

export const IMAGE_MODEL = mockModels.find(
  (model) => model.id === 'aivore-demo-image',
) as ModelSpec;
export const VIDEO_MODEL = mockModels.find(
  (model) => model.id === 'aivore-demo-video',
) as ModelSpec;

export type TestImageFormat = 'png' | 'jpeg' | 'webp';

/** A deterministic picture with structure (gradient, discs, stripes), so edits have something to change. */
export async function makeTestImage(
  width: number,
  height: number,
  format: TestImageFormat = 'png',
): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const disc = Math.hypot(x - width * 0.35, y - height * 0.45) < Math.min(width, height) * 0.22;
      const stripe = Math.floor(x / 24) % 2 === 0;
      raw[o] = disc ? 230 : Math.round((x / width) * 200) + (stripe ? 20 : 0);
      raw[o + 1] = disc ? 90 : Math.round((y / height) * 180);
      raw[o + 2] = disc ? 60 : 120 + (stripe ? 40 : 0);
    }
  }
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  const encoded =
    format === 'png'
      ? await image.png().toBuffer()
      : format === 'jpeg'
        ? await image.jpeg({ quality: 90 }).toBuffer()
        : await image.webp({ quality: 90 }).toBuffer();
  return new Uint8Array(encoded);
}

/**
 * Opaque RGBA made of unrelated random colours (xorshift32, so it is the same on every run): the
 * worst case for building a colour palette, like a photo of static or fine grain.
 */
export function noiseRgba(width: number, height: number, seed: number): Uint8Array {
  let state = (seed * 2_654_435_761) >>> 0 || 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    rgba[i] = i % 4 === 3 ? 255 : (state >>> 8) & 255;
  }
  return rgba;
}

/** A PNG of `noiseRgba`: lossless, so every pixel keeps its own colour through decoding. */
export async function makeNoiseImage(width: number, height: number): Promise<Uint8Array> {
  const png = await sharp(noiseRgba(width, height, 1), {
    raw: { width, height, channels: 4 },
  })
    .removeAlpha()
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

export interface WorkCost {
  /** CPU time of the whole process (all threads, sharp's included), in milliseconds. */
  cpuMs: number;
  /** The longest stretch the event loop went without running a 5 ms timer, in milliseconds. */
  longestStallMs: number;
}

/** Runs `work` and reports what it cost and how long it kept everything else from running. */
export async function measureWork(work: () => Promise<unknown>): Promise<WorkCost> {
  let longestStallMs = 0;
  let last = performance.now();
  const probe = setInterval(() => {
    const now = performance.now();
    longestStallMs = Math.max(longestStallMs, now - last);
    last = now;
  }, 5);
  const before = process.cpuUsage();
  try {
    await work();
  } finally {
    clearInterval(probe);
  }
  const used = process.cpuUsage(before);
  return { cpuMs: (used.user + used.system) / 1000, longestStallMs };
}

export function mockInput(tool: Tool, overrides: Partial<ProviderInput> = {}): ProviderInput {
  const model = tool.endsWith('video') ? VIDEO_MODEL : IMAGE_MODEL;
  const params: GenerationParams = tool.endsWith('video')
    ? { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p', seed: 7 }
    : { aspectRatio: '1:1', count: 1, seed: 7 };
  return {
    generationId: 'gen_0000000000000000000000test',
    tool,
    model,
    prompt: 'a calm lake at dawn',
    params,
    ...overrides,
  };
}

/** Everything the logger would have written, at every level. */
export interface LogCapture {
  lines: string[];
  context: ProviderContext;
}

export function captureContext(overrides: Partial<ProviderContext> = {}): LogCapture {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (_level, line) => void lines.push(line) });
  return { lines, context: fakeProviderContext({ log, env: getEnv(), ...overrides }) };
}

/** Fails the test if anything in the code under test reaches for the network. */
export function forbidNetwork() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('the Demo provider must never touch the network');
  });
  return fetchSpy;
}

/**
 * Runs the real async path: submit, jump the clock past the simulated latency, poll once.
 * Needs `vi.useFakeTimers({ toFake: ['Date'] })` (see `useFakeClock`).
 */
export async function generate(input: ProviderInput, context?: ProviderContext) {
  const { mockProvider } = await import('@/server/providers/mock');
  const ctx = context ?? captureContext().context;
  const submitted = await mockProvider.submit(input, ctx);
  if (submitted.mode === 'sync') return submitted.outputs;
  const durationMs = (submitted.meta as { durationMs: number }).durationMs;
  vi.setSystemTime(Date.now() + durationMs);
  const polled = await mockProvider.poll(submitted.providerJobId, input, ctx, submitted.meta);
  if (polled.status !== 'succeeded') {
    throw new Error(`expected a finished job, got ${JSON.stringify(polled)}`);
  }
  return polled.outputs;
}

/** Freezes `Date` only: timers stay real, so sharp and the event loop behave normally. */
export function useFakeClock() {
  vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
}
