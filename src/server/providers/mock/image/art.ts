import 'server-only';
import sharp, { type OverlayOptions } from 'sharp';
import { createPalette } from '../color';
import { createFlowField, gridToRgba } from '../flow-field';
import { ART_STYLES, detectMood, type ArtStyle } from '../moods';
import { createNoise2D } from '../noise';
import { createRng, hash32 } from '../random';
import { applyLights, applyVignette } from './lights';
import type { Scene } from './scene';
import { buildStyleLayers } from './styles';
import { svgDocument } from './svg';

export interface ArtworkRequest {
  prompt: string;
  negativePrompt?: string;
  seed: number;
  width: number;
  height: number;
}

/** How turbulent the backdrop is per composition, and whether the sky brightens toward the horizon. */
const FIELD_CHARACTER: Record<ArtStyle, { swirl: number; verticalBias: number }> = {
  aurora: { swirl: 0.45, verticalBias: 0 },
  horizon: { swirl: 0.15, verticalBias: 1 },
  orbit: { swirl: 0.4, verticalBias: 0 },
  ribbons: { swirl: 0.3, verticalBias: 0 },
};

/** Lossy WebP keeps a grainy megapixel image at a few hundred KB; PNG would be several MB of noise. */
export const ARTWORK_MIME_TYPE = 'image/webp';

function grain(width: number, height: number, seed: number): Buffer {
  const pixels = Buffer.allocUnsafe(width * height);
  let state = (seed | 1) >>> 0;
  for (let i = 0; i < pixels.length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    // Centred on mid-grey (the neutral value of the soft-light blend), +-28 around it.
    pixels[i] = 100 + (state % 57);
  }
  return pixels;
}

/**
 * Procedural artwork for the Demo image model: a pure function of (prompt, negative prompt, seed,
 * size). A flowing colour field, one of a few vector compositions (aurora, horizon, orbit,
 * ribbons), a vignette and film grain. The prompt only picks colours and composition; it is never
 * drawn as text.
 */
export async function renderArtwork(request: ArtworkRequest): Promise<Buffer> {
  const { prompt, negativePrompt = '', seed, width, height } = request;
  const key = hash32('mock-artwork', prompt.normalize('NFC').trim(), negativePrompt.trim(), seed);
  const rng = createRng(key);
  const mood = detectMood(prompt);
  const palette = createPalette(rng, mood);
  const style = rng.pick(mood && rng.chance(0.8) ? mood.styles : ART_STYLES);

  const grid = createFlowField({
    seed: hash32('mock-field', key),
    palette,
    width,
    height,
    cell: 8,
    octaves: 3,
    ...FIELD_CHARACTER[style],
  }).renderGrid(0);

  const scene: Scene = {
    width,
    height,
    unit: Math.min(width, height),
    rng,
    palette,
    noise: createNoise2D(hash32('mock-ridge', key)),
  };
  const layers = buildStyleLayers(style, scene);
  applyLights(grid, layers.lights);
  applyVignette(grid, { width, height }, palette.ink, 0.55);

  const overlays: OverlayOptions[] = [
    {
      input: Buffer.from(svgDocument(width, height, layers.defs, layers.glow)),
      blend: 'screen',
    },
  ];
  if (layers.shapes) {
    overlays.push({
      input: Buffer.from(svgDocument(width, height, layers.defs, layers.shapes)),
      blend: 'over',
    });
  }
  overlays.push({
    input: grain(width, height, hash32('mock-grain', key)),
    raw: { width, height, channels: 1 },
    blend: 'soft-light',
  });

  return sharp(gridToRgba(grid), { raw: { width: grid.width, height: grid.height, channels: 4 } })
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })
    .composite(overlays)
    .webp({ quality: 90, effort: 2, smartSubsample: true })
    .toBuffer();
}
