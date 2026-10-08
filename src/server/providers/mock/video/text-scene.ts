import 'server-only';
import { createPalette, type Rgb } from '../color';
import { createFlowField } from '../flow-field';
import { detectMood } from '../moods';
import { createRng, hash32 } from '../random';
import { vignetteFactors } from '../shading';
import { yieldToEventLoop } from './pace';

const TAU = Math.PI * 2;

export interface TextSceneRequest {
  prompt: string;
  negativePrompt?: string;
  seed: number;
  width: number;
  height: number;
  frames: number;
  signal?: AbortSignal;
}

interface Orb {
  colour: Rgb;
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  kx: number;
  ky: number;
  px: number;
  py: number;
  radius: number;
  strength: number;
}

interface Firefly {
  x: number;
  y: number;
  ax: number;
  ay: number;
  kx: number;
  ky: number;
  phase: number;
  twinkle: number;
  radius: number;
}

/** Adds a smooth round light of the given radius around (cx, cy). */
function splat(
  rgba: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  colour: Rgb,
  strength: number,
) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  const inverse = 1 / (radius * radius);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const falloff = 1 - (dx * dx + dy * dy) * inverse;
      if (falloff <= 0) continue;
      const weight = falloff * falloff * strength;
      const o = (y * width + x) * 4;
      rgba[o] = Math.min(255, rgba[o]! + colour[0] * weight);
      rgba[o + 1] = Math.min(255, rgba[o + 1]! + colour[1] * weight);
      rgba[o + 2] = Math.min(255, rgba[o + 2]! + colour[2] * weight);
    }
  }
}

/** A thin expanding ring: `progress` 0..1 is its growth, fading in and out at the ends. */
function ripple(
  rgba: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  maxRadius: number,
  progress: number,
  colour: Rgb,
) {
  const radius = maxRadius * progress;
  const thickness = Math.max(2, maxRadius * 0.014);
  const strength = Math.sin(Math.PI * progress) * 0.32;
  const outer = radius + thickness;
  const y0 = Math.max(0, Math.floor(cy - outer));
  const y1 = Math.min(height - 1, Math.ceil(cy + outer));
  const x0 = Math.max(0, Math.floor(cx - outer));
  const x1 = Math.min(width - 1, Math.ceil(cx + outer));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distance = Math.abs(Math.hypot(x - cx, y - cy) - radius);
      if (distance >= thickness) continue;
      const weight = (1 - distance / thickness) * strength;
      const o = (y * width + x) * 4;
      rgba[o] = Math.min(255, rgba[o]! + colour[0] * weight);
      rgba[o + 1] = Math.min(255, rgba[o + 1]! + colour[1] * weight);
      rgba[o + 2] = Math.min(255, rgba[o + 2]! + colour[2] * weight);
    }
  }
}

/**
 * The Demo text-to-video scene: a flowing colour field, a few slow orbs, ripples and fireflies.
 * Every moving part follows a closed path in `phase`, so the last frame leads straight back to the
 * first and the GIF loops without a seam. Returns one RGBA buffer per frame.
 */
export async function renderTextVideoFrames(request: TextSceneRequest): Promise<Uint8Array[]> {
  const { prompt, negativePrompt = '', seed, width, height, frames, signal } = request;
  const key = hash32('mock-scene', prompt.normalize('NFC').trim(), negativePrompt.trim(), seed);
  const rng = createRng(key);
  const palette = createPalette(rng, detectMood(prompt));
  const unit = Math.min(width, height);
  const field = createFlowField({
    seed: hash32('mock-flow', key),
    palette,
    width,
    height,
    cell: 5,
    octaves: 3,
    swirl: 0.35,
    motion: 0.12,
  });

  const lights = [palette.accent, palette.glow, palette.ramp[3], palette.ramp[4]];
  const orbs: Orb[] = Array.from({ length: rng.int(3, 4) }, (_, i) => ({
    colour: lights[i % lights.length] as Rgb,
    cx: width * rng.range(0.25, 0.75),
    cy: height * rng.range(0.25, 0.75),
    ax: width * rng.range(0.08, 0.22),
    ay: height * rng.range(0.08, 0.22),
    kx: rng.int(1, 2),
    ky: rng.int(1, 2),
    px: rng.next(),
    py: rng.next(),
    radius: unit * rng.range(0.2, 0.34),
    strength: palette.dark ? rng.range(0.32, 0.5) : rng.range(0.16, 0.26),
  }));
  const fireflies: Firefly[] = Array.from({ length: rng.int(22, 36) }, () => ({
    x: width * rng.next(),
    y: height * rng.next(),
    ax: unit * rng.range(0.01, 0.05),
    ay: unit * rng.range(0.01, 0.05),
    kx: rng.int(1, 2),
    ky: rng.int(1, 2),
    phase: rng.next(),
    twinkle: rng.int(1, 3),
    radius: unit * rng.range(0.005, 0.011),
  }));
  const ripples = [
    { x: width * rng.range(0.35, 0.65), y: height * rng.range(0.35, 0.65), offset: 0 },
    { x: width * rng.range(0.3, 0.7), y: height * rng.range(0.3, 0.7), offset: 0.5 },
  ];
  const vignette = vignetteFactors(width, height, 0.45);

  const output: Uint8Array[] = [];
  for (let frame = 0; frame < frames; frame++) {
    signal?.throwIfAborted();
    const phase = frame / frames;
    const rgba = new Uint8Array(width * height * 4);
    field.render(phase, rgba);

    for (const orb of orbs) {
      const x = orb.cx + orb.ax * Math.cos(TAU * (phase * orb.kx + orb.px));
      const y = orb.cy + orb.ay * Math.sin(TAU * (phase * orb.ky + orb.py));
      const pulse = 1 + 0.12 * Math.sin(TAU * (phase + orb.px));
      splat(rgba, width, height, x, y, orb.radius * pulse, orb.colour, orb.strength);
    }
    for (const ring of ripples) {
      ripple(
        rgba,
        width,
        height,
        ring.x,
        ring.y,
        unit * 0.55,
        (phase + ring.offset) % 1,
        palette.glow,
      );
    }
    for (const fly of fireflies) {
      const x = fly.x + fly.ax * Math.sin(TAU * (phase * fly.kx + fly.phase));
      const y = fly.y + fly.ay * Math.cos(TAU * (phase * fly.ky + fly.phase));
      const glow = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(TAU * (phase * fly.twinkle + fly.phase)));
      splat(rgba, width, height, x, y, fly.radius * 2.2, palette.glow, glow * 0.75);
    }
    for (let i = 0, o = 0; i < vignette.length; i++, o += 4) {
      const factor = vignette[i]!;
      rgba[o] = rgba[o]! * factor;
      rgba[o + 1] = rgba[o + 1]! * factor;
      rgba[o + 2] = rgba[o + 2]! * factor;
    }
    output.push(rgba);
    await yieldToEventLoop();
  }
  return output;
}
