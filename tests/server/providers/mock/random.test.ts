import { describe, expect, it } from 'vitest';
import { createNoise2D, fbm } from '@/server/providers/mock/noise';
import { createRng, hash32, mix32, subSeed, toSeed } from '@/server/providers/mock/random';

describe('hash32', () => {
  it('is deterministic, order-sensitive and boundary-sensitive', () => {
    expect(hash32('a', 1)).toBe(hash32('a', 1));
    expect(hash32('a', 'b')).not.toBe(hash32('b', 'a'));
    expect(hash32('ab', 'c')).not.toBe(hash32('a', 'bc'));
    expect(hash32('x')).toBeGreaterThanOrEqual(0);
    expect(hash32('x')).toBeLessThan(2 ** 32);
  });

  it('spreads neighbouring inputs', () => {
    const values = new Set(Array.from({ length: 500 }, (_, i) => hash32('seed', i)));
    expect(values.size).toBe(500);
  });
});

describe('seeds', () => {
  it('normalises any number to an unsigned 32-bit integer', () => {
    expect(toSeed(42)).toBe(42);
    expect(toSeed(-1)).toBe(0xffff_ffff);
    expect(toSeed(2 ** 32 + 5)).toBe(5);
    expect(toSeed(3.9)).toBe(3);
    expect(toSeed(Number.NaN)).toBe(0);
    expect(toSeed(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('keeps the base seed for image 0 and gives every other image its own', () => {
    expect(subSeed(1234, 0)).toBe(1234);
    const seeds = [0, 1, 2, 3].map((index) => subSeed(1234, index));
    expect(new Set(seeds).size).toBe(4);
    expect(subSeed(1234, 2)).toBe(subSeed(1234, 2));
    expect(mix32(1)).not.toBe(mix32(2));
  });
});

describe('createRng', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = createRng(9);
    const b = createRng(9);
    const c = createRng(10);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(first);
  });

  it('stays within its ranges', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const unit = rng.next();
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
      const between = rng.range(-2, 5);
      expect(between).toBeGreaterThanOrEqual(-2);
      expect(between).toBeLessThan(5);
      const whole = rng.int(2, 4);
      expect([2, 3, 4]).toContain(whole);
      expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    }
    expect(createRng(1).chance(0)).toBe(false);
  });
});

describe('noise', () => {
  it('is deterministic per seed, bounded and smooth', () => {
    const noise = createNoise2D(5);
    expect(noise(1.37, 2.9)).toBe(createNoise2D(5)(1.37, 2.9));
    expect(noise(1.37, 2.9)).not.toBe(createNoise2D(6)(1.37, 2.9));
    let max = 0;
    for (let i = 0; i < 4000; i++) {
      const x = i * 0.0137;
      const value = fbm(noise, x, x * 0.7, 4);
      max = Math.max(max, Math.abs(value));
      expect(Math.abs(value - fbm(noise, x + 0.001, x * 0.7, 4))).toBeLessThan(0.05);
    }
    expect(max).toBeLessThanOrEqual(1.2);
    expect(max).toBeGreaterThan(0.2);
  });
});
