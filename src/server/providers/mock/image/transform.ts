import 'server-only';
import sharp from 'sharp';
import { createPalette, mixRgb, type Rgb } from '../color';
import { decodeToRaw, invalidInputImage, probeDisplaySize, type RawImage } from '../input-image';
import { detectMood } from '../moods';
import { createRng, hash32, type Rng } from '../random';
import { vignetteFactors } from '../shading';
import { fitImageToBudget } from '../size';

const MODES = ['tone', 'dream', 'fade'] as const;
type Mode = (typeof MODES)[number];

export interface TransformRequest {
  imageBytes: Uint8Array;
  prompt: string;
  negativePrompt?: string;
  seed: number;
  /** 0..1: how far the result moves away from the input (default 0.6, minimum 0.1). */
  strength?: number;
}

export interface TransformedImage {
  bytes: Buffer;
  width: number;
  height: number;
}

/** Lowest effective strength: even "no change" requests visibly do something in a demo. */
const MIN_STRENGTH = 0.1;
const DEFAULT_STRENGTH = 0.6;

export function effectiveStrength(strength: number | undefined): number {
  if (strength === undefined || !Number.isFinite(strength)) return DEFAULT_STRENGTH;
  return Math.min(1, Math.max(MIN_STRENGTH, strength));
}

/** Row-major 3x3 colour matrix. */
type Matrix = readonly [number, number, number, number, number, number, number, number, number];

interface Grade {
  mode: Mode;
  /** Hue rotation and saturation, applied to 0..255 channels. */
  matrix: Matrix;
  brightness: number;
  contrast: number;
  /** Split-toning colours for shadows and highlights, and how strongly they replace the originals. */
  shadow: Rgb;
  highlight: Rgb;
  toneWeight: number;
  lift: number;
  vignette: number;
  grain: number;
  blur: number;
  glow: number;
}

/** Hue rotation by `degrees` plus a saturation factor, as one matrix (the usual YIQ-style derivation). */
function hueSaturationMatrix(degrees: number, saturation: number): Matrix {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle) * saturation;
  const sin = Math.sin(angle) * saturation;
  return [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];
}

function chooseGrade(rng: Rng, prompt: string, strength: number): Grade {
  const palette = createPalette(rng, detectMood(prompt));
  const mode = rng.pick(MODES);
  const direction = rng.chance(0.5) ? 1 : -1;
  const shadow = mixRgb(palette.ramp[0], palette.ramp[1], 0.4);
  const highlight = mixRgb(palette.ramp[3], palette.glow, 0.45);
  return {
    mode,
    matrix: hueSaturationMatrix(
      direction * rng.range(25, 150) * strength,
      1 + rng.range(0.12, 0.55) * strength * (mode === 'fade' ? 0.3 : 1),
    ),
    brightness: 1 + rng.range(-0.06, 0.12) * strength,
    contrast: 1 + (mode === 'fade' ? -0.12 : 0.14) * strength,
    shadow,
    highlight,
    toneWeight: strength * (mode === 'tone' ? rng.range(0.35, 0.6) : rng.range(0.1, 0.22)),
    lift: mode === 'fade' ? 26 * strength : 0,
    vignette: 0.55 * strength,
    grain: 3 + 7 * strength,
    blur: mode === 'dream' ? 1.5 + 3.5 * strength : 0,
    glow: mode === 'dream' ? 0.35 * strength + 0.1 : 0,
  };
}

async function blurred(image: RawImage, sigma: number): Promise<Uint8Array> {
  const { data } = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Applies the grade to every pixel; alpha is left alone. */
function applyGrade(image: RawImage, soft: Uint8Array | undefined, grade: Grade, seed: number) {
  const { data, width, height } = image;
  const m = grade.matrix;
  const vignette = vignetteFactors(width, height, grade.vignette);
  const tone = [grade.shadow, grade.highlight] as const;
  let state = (seed | 1) >>> 0;
  for (let i = 0, o = 0; i < vignette.length; i++, o += 4) {
    let r = data[o]!;
    let g = data[o + 1]!;
    let b = data[o + 2]!;
    if (soft) {
      // Screen the blurred copy over the sharp one: a soft glow around bright areas.
      r = 255 - ((255 - r) * (255 - soft[o]! * grade.glow)) / 255;
      g = 255 - ((255 - g) * (255 - soft[o + 1]! * grade.glow)) / 255;
      b = 255 - ((255 - b) * (255 - soft[o + 2]! * grade.glow)) / 255;
    }
    let nr = m[0] * r + m[1] * g + m[2] * b;
    let ng = m[3] * r + m[4] * g + m[5] * b;
    let nb = m[6] * r + m[7] * g + m[8] * b;

    const luma = (0.299 * nr + 0.587 * ng + 0.114 * nb) / 255;
    // Split toning: blend each pixel toward a shadow colour in the darks and a highlight in the lights.
    const target = luma < 0.5 ? tone[0] : tone[1];
    const pull = grade.toneWeight * (luma < 0.5 ? 1 - luma * 2 : luma * 2 - 1) * 1.6;
    nr += (target[0] - nr) * pull;
    ng += (target[1] - ng) * pull;
    nb += (target[2] - nb) * pull;

    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const grain = ((state & 255) / 255 - 0.5) * grade.grain;
    const factor = grade.brightness * vignette[i]!;
    nr = ((nr - 128) * grade.contrast + 128) * factor + grade.lift + grain;
    ng = ((ng - 128) * grade.contrast + 128) * factor + grade.lift + grain;
    nb = ((nb - 128) * grade.contrast + 128) * factor + grade.lift + grain;
    data[o] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    data[o + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    data[o + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }
}

/**
 * The Demo image-to-image edit: a seeded colour grade of the uploaded picture (hue, saturation and
 * brightness shift, split toning, an optional dreamy glow or faded blacks, vignette and grain), all
 * scaled by `strength`. The output keeps the input's aspect ratio (shrunk to about one megapixel
 * when larger) and is never the input unchanged.
 */
export async function transformImage(request: TransformRequest): Promise<TransformedImage> {
  const { imageBytes, prompt, negativePrompt = '', seed } = request;
  const strength = effectiveStrength(request.strength);
  const display = await probeDisplaySize(imageBytes);
  const size = fitImageToBudget(display.width, display.height);
  const image = await decodeToRaw(imageBytes, size, { flatten: false });

  const key = hash32('mock-transform', prompt.normalize('NFC').trim(), negativePrompt.trim(), seed);
  const grade = chooseGrade(createRng(key), prompt, strength);
  const soft = grade.blur > 0 ? await blurred(image, grade.blur) : undefined;
  applyGrade(image, soft, grade, key);

  try {
    let pipeline = sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: 4 },
    });
    if (grade.mode === 'tone') pipeline = pipeline.sharpen({ sigma: 0.8 + strength });
    const bytes = await pipeline.webp({ quality: 90, effort: 2 }).toBuffer();
    return { bytes, width: image.width, height: image.height };
  } catch (error) {
    throw invalidInputImage(error);
  }
}
