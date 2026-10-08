import 'server-only';
import { createRng } from './random';

export type Noise2D = (x: number, y: number) => number;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Seeded 2-D gradient (Perlin) noise, roughly in [-1, 1]. */
export function createNoise2D(seed: number): Noise2D {
  const rng = createRng(seed);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const perm = new Uint8Array(512);
  const gradX = new Float32Array(256);
  const gradY = new Float32Array(256);
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255] as number;
  for (let i = 0; i < 256; i++) {
    const angle = rng.range(0, Math.PI * 2);
    gradX[i] = Math.cos(angle);
    gradY[i] = Math.sin(angle);
  }

  return (x, y) => {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const dx = x - fx;
    const dy = y - fy;
    const x0 = fx & 255;
    const y0 = fy & 255;
    const row0 = perm[x0]!;
    const row1 = perm[x0 + 1]!;
    const g00 = perm[row0 + y0]!;
    const g10 = perm[row1 + y0]!;
    const g01 = perm[row0 + y0 + 1]!;
    const g11 = perm[row1 + y0 + 1]!;
    const n00 = gradX[g00]! * dx + gradY[g00]! * dy;
    const n10 = gradX[g10]! * (dx - 1) + gradY[g10]! * dy;
    const n01 = gradX[g01]! * dx + gradY[g01]! * (dy - 1);
    const n11 = gradX[g11]! * (dx - 1) + gradY[g11]! * (dy - 1);
    const u = fade(dx);
    const v = fade(dy);
    const top = n00 + (n10 - n00) * u;
    const bottom = n01 + (n11 - n01) * u;
    return (top + (bottom - top) * v) * 1.414;
  };
}

/** Fractal sum of `octaves` noise layers, normalised to roughly [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x * frequency + i * 17.3, y * frequency - i * 9.1);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}
