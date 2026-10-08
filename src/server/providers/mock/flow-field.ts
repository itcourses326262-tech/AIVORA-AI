import 'server-only';
import { mixRgb, sampleRamp, type Palette, type Rgb } from './color';
import { createNoise2D, fbm } from './noise';
import { createRng } from './random';

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export interface FlowFieldOptions {
  seed: number;
  palette: Palette;
  width: number;
  height: number;
  /** Pixels per colour sample; the field is smooth, so it is evaluated sparsely and interpolated. */
  cell: number;
  octaves: number;
  /** 0 is a calm, almost gradient-like backdrop; 1 is turbulent marbling. */
  swirl: number;
  /** Positive values make the bottom lighter than the top (a sky brightening toward the horizon). */
  verticalBias?: number;
  /** Radius, in noise units, of the closed path `phase` travels on: how fast an animation flows. */
  motion?: number;
}

export interface FlowGrid {
  /** Samples per row and number of rows. */
  width: number;
  height: number;
  /** RGB floats in 0..255, `width * height * 3`. */
  rgb: Float32Array;
  /** Canvas pixels per sample along each axis (the grid is stretched to the canvas, centre to centre). */
  scaleX: number;
  scaleY: number;
}

/** The grid as 8-bit RGBA (alpha 255), ready for an image library. */
export function gridToRgba(grid: FlowGrid): Uint8Array {
  const rgba = new Uint8Array(grid.width * grid.height * 4);
  for (let i = 0, o = 0; i < grid.rgb.length; i += 3, o += 4) {
    rgba[o] = Math.round(Math.min(255, Math.max(0, grid.rgb[i]!)));
    rgba[o + 1] = Math.round(Math.min(255, Math.max(0, grid.rgb[i + 1]!)));
    rgba[o + 2] = Math.round(Math.min(255, Math.max(0, grid.rgb[i + 2]!)));
    rgba[o + 3] = 255;
  }
  return rgba;
}

/** Canvas coordinate of the centre of sample `index` when a grid with `scale` pixels per sample is stretched over a canvas. */
export function samplePosition(index: number, scale: number): number {
  return (index + 0.5) * scale - 0.5;
}

export interface FlowField {
  /** The sparse grid of colours; stretch it to the canvas with a smooth resampler. */
  renderGrid(phase: number): FlowGrid;
  /**
   * Paints the full canvas into `out` (RGBA, `width * height * 4`) with bilinear interpolation.
   * `phase` in [0, 1) moves the pattern along a closed path, so phase 0 and 1 are the same picture
   * (seamless video loops).
   */
  render(phase: number, out: Uint8Array): void;
}

/**
 * Domain-warped fractal noise mapped through the palette ramp: the flowing backdrop of every Demo
 * image and video.
 */
export function createFlowField(options: FlowFieldOptions): FlowField {
  const {
    seed,
    palette,
    width,
    height,
    cell,
    octaves,
    swirl,
    verticalBias = 0,
    motion = 0.45,
  } = options;
  const rng = createRng(seed ^ 0x51ed_270b);
  const noise = createNoise2D(seed);
  const scale = lerp(0.75, 1.9, swirl) * rng.range(0.9, 1.15);
  const warp = lerp(0.9, 3, swirl) * rng.range(0.9, 1.1);
  const contrast = lerp(1.05, 1.5, swirl);
  const originX = rng.range(0, 200);
  const originY = rng.range(0, 200);
  const drift = motion * rng.range(0.8, 1.2);
  const longest = Math.max(width, height);
  const gridW = Math.max(2, Math.round(width / cell));
  const gridH = Math.max(2, Math.round(height / cell));
  const scaleX = width / gridW;
  const scaleY = height / gridH;
  const samples = new Float32Array(gridW * gridH * 3);
  const colour: Rgb = [0, 0, 0];

  function evaluate(phase: number) {
    const angle = phase * TAU;
    const ox = Math.cos(angle) * drift;
    const oy = Math.sin(angle) * drift;
    let cursor = 0;
    for (let gy = 0; gy < gridH; gy++) {
      const py = samplePosition(gy, scaleY);
      const y = originY + (py / longest) * scale;
      const lift = verticalBias * (py / height - 0.5);
      for (let gx = 0; gx < gridW; gx++) {
        const x = originX + (samplePosition(gx, scaleX) / longest) * scale;
        const qx = fbm(noise, x + ox * 0.6, y + oy * 0.6, octaves);
        const qy = fbm(noise, x + 5.2 - oy * 0.6, y + 1.3 + ox * 0.6, octaves);
        const rx = fbm(noise, x + warp * qx + 1.7 + oy, y + warp * qy + 9.2 - ox, octaves);
        const ry = fbm(noise, x + warp * qx + 8.3 - ox, y + warp * qy + 2.8 + oy, octaves);
        const f = fbm(noise, x + warp * rx, y + warp * ry, octaves);

        sampleRamp(palette.ramp, 0.5 + f * contrast + (rx - ry) * 0.12 + lift, colour);
        const accentWeight = smoothstep(0.2, 0.8, Math.hypot(qx, qy)) * 0.16;
        const glowWeight = smoothstep(0.45, 1, f * 1.4 + rx * 0.4) * 0.16;
        const mixed = mixRgb(
          mixRgb(colour, palette.accent, accentWeight),
          palette.glow,
          glowWeight,
        );
        samples[cursor++] = mixed[0];
        samples[cursor++] = mixed[1];
        samples[cursor++] = mixed[2];
      }
    }
  }

  function renderGrid(phase: number): FlowGrid {
    evaluate(phase);
    return { width: gridW, height: gridH, rgb: samples.slice(), scaleX, scaleY };
  }

  function render(phase: number, out: Uint8Array) {
    evaluate(phase);
    for (let y = 0; y < height; y++) {
      const gy = Math.min(gridH - 1, Math.max(0, (y + 0.5) / scaleY - 0.5));
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const row0 = y0 * gridW;
      const row1 = Math.min(gridH - 1, y0 + 1) * gridW;
      for (let x = 0; x < width; x++) {
        const gx = Math.min(gridW - 1, Math.max(0, (x + 0.5) / scaleX - 0.5));
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const x1 = Math.min(gridW - 1, x0 + 1);
        const a = (row0 + x0) * 3;
        const b = (row0 + x1) * 3;
        const c = (row1 + x0) * 3;
        const d = (row1 + x1) * 3;
        const o = (y * width + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = samples[a + ch]! + (samples[b + ch]! - samples[a + ch]!) * fx;
          const bottom = samples[c + ch]! + (samples[d + ch]! - samples[c + ch]!) * fx;
          out[o + ch] = top + (bottom - top) * fy;
        }
        out[o + 3] = 255;
      }
    }
  }

  return { renderGrid, render };
}
