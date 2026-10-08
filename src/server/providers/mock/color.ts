import 'server-only';
import type { Mood } from './moods';
import type { Rng } from './random';

/** sRGB channels as floats in 0..255. */
export type Rgb = [number, number, number];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function linearToSrgb(value: number): number {
  return value <= 0.003_130_8 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function oklchToLinear(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = Math.pow(lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b, 3);
  const m = Math.pow(lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b, 3);
  const s = Math.pow(lightness - 0.089_484_177_5 * a - 1.291_485_548 * b, 3);
  return [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((channel) => channel >= -0.001 && channel <= 1.001);

/** OKLCH (hue in degrees) to sRGB; chroma is reduced until the colour fits instead of clipping the hue. */
export function oklch(lightness: number, chroma: number, hue: number): Rgb {
  let low = 0;
  let high = chroma;
  let linear = oklchToLinear(lightness, chroma, hue);
  if (!inGamut(linear)) {
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear(lightness, mid, hue))) low = mid;
      else high = mid;
    }
    linear = oklchToLinear(lightness, low, hue);
  }
  return linear.map((channel) => clamp01(linearToSrgb(clamp01(channel))) * 255) as Rgb;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export interface Palette {
  /** Five stops from the darkest to the lightest, the colour ramp of the flowing background. */
  ramp: [Rgb, Rgb, Rgb, Rgb, Rgb];
  /** A contrasting colour for highlights and focal shapes. */
  accent: Rgb;
  /** A bright, slightly tinted white for light sources. */
  glow: Rgb;
  /** A very dark tinted black for silhouettes. */
  ink: Rgb;
  dark: boolean;
}

/** How far (in hue degrees) the accent sits from the ramp, per colour scheme. */
const ACCENT_OFFSET = {
  analogous: 78,
  complementary: 180,
  triad: 120,
  split: 152,
} as const;
export type Scheme = keyof typeof ACCENT_OFFSET;
const SCHEME_NAMES = Object.keys(ACCENT_OFFSET) as [Scheme, ...Scheme[]];

/**
 * The ramp drifts a little in hue from dark to light (always analogous, so fields stay cohesive);
 * the scheme only decides where the pop-colour accent sits on the colour wheel.
 */
export function createPalette(rng: Rng, mood?: Mood): Palette {
  const scheme = mood?.scheme ?? rng.pick(SCHEME_NAMES);
  const hue = (mood?.hue ?? rng.range(0, 360)) + rng.range(-12, 12);
  const direction = rng.chance(0.5) ? 1 : -1;
  const dark = mood?.dark ?? rng.chance(0.7);
  const chroma = mood?.chroma ?? 1;
  const shift = mood?.lightness ?? 0;
  const lightness = dark ? [0.17, 0.31, 0.5, 0.72, 0.91] : [0.42, 0.6, 0.74, 0.86, 0.96];
  const vividness = [0.05, 0.095, 0.145, 0.135, 0.07];
  const drift = [-14, 0, 18, 34, 50];
  const at = (index: number) =>
    oklch(
      clamp01((lightness[index] as number) + shift),
      (vividness[index] as number) * chroma,
      hue + direction * (drift[index] as number),
    );
  return {
    ramp: [at(0), at(1), at(2), at(3), at(4)],
    accent: oklch(
      clamp01(0.78 + shift * 0.5),
      0.15 * chroma,
      hue + direction * ACCENT_OFFSET[scheme] * (rng.chance(0.5) ? 1 : -1),
    ),
    glow: oklch(0.95, 0.05 * chroma, hue + direction * 50),
    ink: oklch(0.11 + shift * 0.2, 0.035 * chroma, hue),
    dark,
  };
}

/** Piecewise-linear colour lookup along the palette ramp, `t` in [0, 1]. */
export function sampleRamp(ramp: Palette['ramp'], t: number, out: Rgb): void {
  const scaled = clamp01(t) * (ramp.length - 1);
  const index = Math.min(ramp.length - 2, Math.floor(scaled));
  const local = scaled - index;
  // Smoothstep keeps the stops from showing up as bands.
  const eased = local * local * (3 - 2 * local);
  const from = ramp[index] as Rgb;
  const to = ramp[index + 1] as Rgb;
  out[0] = from[0] + (to[0] - from[0]) * eased;
  out[1] = from[1] + (to[1] - from[1]) * eased;
  out[2] = from[2] + (to[2] - from[2]) * eased;
}
