import 'server-only';
import { GIFEncoder, quantize, type Palette } from '@/lib/gifenc';
import { yieldToEventLoop } from './pace';

// Bayer 8x8 ordered-dither thresholds, 0..63.
const BAYER = Uint8Array.from([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
]);

/** Roughly this many pixels are sampled across the clip to build the single shared palette. */
const PALETTE_SAMPLE_PIXELS = 90_000;
const SAMPLED_FRAMES = 6;

export interface GifRequest {
  /** RGBA frames of `width * height * 4` bytes each. */
  frames: readonly Uint8Array[];
  width: number;
  height: number;
  /** Delay between two frames; GIF stores whole hundredths of a second. */
  delayMs: number;
  /** Peak-to-peak size of the ordered dither, in colour levels. */
  dither: number;
  signal?: AbortSignal;
}

/** One palette for the whole clip (no colour flicker between frames), built from a few frames. */
function buildPalette(frames: readonly Uint8Array[], pixelsPerFrame: number): Palette {
  const picked = Math.min(SAMPLED_FRAMES, frames.length);
  const perFrame = Math.max(1, Math.floor(PALETTE_SAMPLE_PIXELS / picked));
  const stride = Math.max(1, Math.floor(pixelsPerFrame / perFrame));
  const sample = new Uint8Array(picked * Math.ceil(pixelsPerFrame / stride) * 4);
  let cursor = 0;
  for (let i = 0; i < picked; i++) {
    const frame = frames[Math.floor((i * frames.length) / picked)] as Uint8Array;
    for (let pixel = 0; pixel < pixelsPerFrame; pixel += stride) {
      sample.set(frame.subarray(pixel * 4, pixel * 4 + 4), cursor);
      cursor += 4;
    }
  }
  // gifenc reads the whole ArrayBuffer, so the array must not carry unused capacity.
  return quantize(sample.slice(0, cursor), 256);
}

/** Palette index for every 15-bit colour, so each pixel costs one table lookup. */
function buildLookup(palette: Palette): Uint8Array {
  const flat = Int32Array.from(palette.flatMap((colour) => [colour[0], colour[1], colour[2]]));
  const entries = flat.length / 3;
  const lookup = new Uint8Array(32768);
  for (let key = 0; key < 32768; key++) {
    const r = ((key >> 10) & 31) * 8 + 4;
    const g = ((key >> 5) & 31) * 8 + 4;
    const b = (key & 31) * 8 + 4;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < entries; i++) {
      const dr = flat[i * 3]! - r;
      const dg = flat[i * 3 + 1]! - g;
      const db = flat[i * 3 + 2]! - b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    lookup[key] = best;
  }
  return lookup;
}

function indexFrame(
  rgba: Uint8Array,
  width: number,
  height: number,
  lookup: Uint8Array,
  dither: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const scale = dither / 64;
  let o = 0;
  for (let y = 0; y < height; y++) {
    const row = (y & 7) * 8;
    for (let x = 0; x < width; x++, o++) {
      const offset = (BAYER[row + (x & 7)]! - 31.5) * scale;
      const p = o * 4;
      let r = rgba[p]! + offset;
      let g = rgba[p + 1]! + offset;
      let b = rgba[p + 2]! + offset;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      out[o] = lookup[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]!;
    }
  }
  return out;
}

/** Encodes RGBA frames as a looping animated GIF with one shared 256-colour palette. */
export async function encodeGif(request: GifRequest): Promise<Uint8Array> {
  const { frames, width, height, delayMs, dither, signal } = request;
  const palette = buildPalette(frames, width * height);
  const lookup = buildLookup(palette);
  const encoder = GIFEncoder({ initialCapacity: 1 << 20 });
  for (const [index, rgba] of frames.entries()) {
    signal?.throwIfAborted();
    encoder.writeFrame(indexFrame(rgba, width, height, lookup, dither), width, height, {
      // The first frame's palette becomes the global colour table every later frame reuses.
      ...(index === 0 ? { palette } : {}),
      delay: delayMs,
      repeat: 0,
    });
    await yieldToEventLoop();
  }
  encoder.finish();
  return encoder.bytes();
}
