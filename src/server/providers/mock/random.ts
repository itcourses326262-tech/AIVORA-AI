import 'server-only';
import { createHash } from 'node:crypto';

/** Everything the Demo provider draws is a pure function of these helpers, so output is reproducible. */

const UINT32 = 0x1_0000_0000;

/** A well-spread unsigned 32-bit hash of the parts (order and boundaries matter). */
export function hash32(...parts: Array<string | number>): number {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest();
  return digest.readUInt32BE(0);
}

/** Murmur3 finaliser: scrambles a 32-bit integer so that neighbouring inputs look unrelated. */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85eb_ca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2_ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Any finite number to an unsigned 32-bit integer (non-finite values become 0). */
export function toSeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value) % UINT32;
  return (truncated < 0 ? truncated + UINT32 : truncated) >>> 0;
}

/**
 * Seed of the n-th image of a batch. Image 0 keeps the base seed, so a single generation with the
 * seed echoed in `ProviderOutput.seed` reproduces exactly that image.
 */
export function subSeed(seed: number, index: number): number {
  return index === 0 ? seed >>> 0 : mix32(seed + Math.imul(index, 0x9e37_79b9));
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly [T, ...T[]]): T;
}

/** mulberry32: tiny, fast and plenty good for artwork. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
  };
}
