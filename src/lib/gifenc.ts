import * as gifencModule from 'gifenc';

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
export const quantize = api.quantize;
export const prequantize = api.prequantize;
export const applyPalette = api.applyPalette;
export const nearestColorIndex = api.nearestColorIndex;
export const nearestColorIndexWithDistance = api.nearestColorIndexWithDistance;
export const nearestColor = api.nearestColor;
export const snapColorsToPalette = api.snapColorsToPalette;
export type {
  GifEncoderInstance,
  Palette,
  PixelFormat,
  QuantizeOptions,
  RgbColor,
  RgbaColor,
  WriteFrameOptions,
} from 'gifenc';
