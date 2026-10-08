import * as gifencModule from 'gifenc';
import type { Palette, PixelFormat, PrequantizeOptions, QuantizeOptions } from 'gifenc';

type GifencApi = typeof gifencModule.default;

// gifenc is a CommonJS package with a separate ESM build and no "exports" map. Bundlers
// (Next.js, Vitest) pick the ESM build and expose named exports, while Node's native ESM
// loader (tsx: the external worker and scripts) sees the CJS build, whose named exports it
// cannot detect, so everything sits on `default`. Resolve whichever shape we got, once.
function resolveApi(): GifencApi {
  const candidate = gifencModule as Partial<GifencApi> & { default?: GifencApi };
  if (candidate.GIFEncoder) return candidate as GifencApi;
  if (candidate.default?.GIFEncoder) return candidate.default;
  throw new Error('gifenc did not expose its API in this runtime');
}

const api = resolveApi();

export const GIFEncoder = api.GIFEncoder;

type Pixels = Uint8Array | Uint8ClampedArray;

// gifenc's quantize(), prequantize() and applyPalette() build `new Uint32Array(rgba.buffer)`,
// i.e. they read the *whole* underlying ArrayBuffer and ignore byteOffset and byteLength. A pooled
// Node Buffer (Buffer.from, sharp output) or a subarray would therefore be read together with
// whatever bytes surround it, without any error. The wrappers below make that impossible by
// working on a private copy whenever the view does not span its entire buffer.
function ownsWholeBuffer(rgba: Pixels): boolean {
  return rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength;
}

function ownedPixels(rgba: Pixels): Pixels {
  return ownsWholeBuffer(rgba) ? rgba : new Uint8Array(rgba);
}

export function quantize(rgba: Pixels, maxColors: number, options?: QuantizeOptions): Palette {
  return api.quantize(ownedPixels(rgba), maxColors, options);
}

export function applyPalette(rgba: Pixels, palette: Palette, format?: PixelFormat): Uint8Array {
  return api.applyPalette(ownedPixels(rgba), palette, format);
}

/** Rounds the colours of `rgba` in place, like the original, whatever view of memory it is. */
export function prequantize(rgba: Pixels, options?: PrequantizeOptions): void {
  if (ownsWholeBuffer(rgba)) {
    api.prequantize(rgba, options);
    return;
  }
  const copy = new Uint8Array(rgba);
  api.prequantize(copy, options);
  rgba.set(copy);
}

export const nearestColorIndex = api.nearestColorIndex;
export const nearestColorIndexWithDistance = api.nearestColorIndexWithDistance;
export const nearestColor = api.nearestColor;
export const snapColorsToPalette = api.snapColorsToPalette;
export type {
  GifEncoderInstance,
  Palette,
  PixelFormat,
  PrequantizeOptions,
  QuantizeOptions,
  RgbColor,
  RgbaColor,
  WriteFrameOptions,
} from 'gifenc';
