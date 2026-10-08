import { describe, expect, it } from 'vitest';
import { GIFEncoder, applyPalette, prequantize, quantize, type Palette } from '@/lib/gifenc';

const WIDTH = 4;
const HEIGHT = 4;
const PIXELS = WIDTH * HEIGHT;

/** Left half red, right half blue. */
function checker(): Uint8Array {
  const rgba = new Uint8Array(PIXELS * 4);
  for (let i = 0; i < PIXELS; i++) {
    const red = i % WIDTH < WIDTH / 2;
    rgba.set(red ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  }
  return rgba;
}

const PALETTE: Palette = [
  [255, 0, 0],
  [0, 0, 255],
];

function expectedIndices(): number[] {
  return Array.from({ length: PIXELS }, (_, i) => (i % WIDTH < WIDTH / 2 ? 0 : 1));
}

/** A Buffer that lives inside Node's shared pool, so its byteOffset is not 0. */
function pooledBuffer(bytes: Uint8Array): Buffer {
  Buffer.from([1, 2, 3, 4]); // make sure the pool cursor has moved
  const buffer = Buffer.from(bytes);
  expect(buffer.byteOffset, 'precondition: the Buffer must come from the pool').not.toBe(0);
  expect(
    buffer.buffer.byteLength,
    'precondition: the pool is larger than the data',
  ).toBeGreaterThan(bytes.length);
  return buffer;
}

/** The pixels placed in the middle of a larger ArrayBuffer filled with unrelated bytes. */
function subarrayOf(bytes: Uint8Array): Uint8Array {
  const slab = new Uint8Array(bytes.length + 128).fill(0x7f);
  slab.set(bytes, 64);
  return slab.subarray(64, 64 + bytes.length);
}

describe('applyPalette', () => {
  it('maps every pixel of a plain Uint8Array', () => {
    expect(Array.from(applyPalette(checker(), PALETTE))).toEqual(expectedIndices());
  });

  it('only reads the view of a pooled Buffer, not the whole pool', () => {
    const indices = applyPalette(pooledBuffer(checker()), PALETTE);
    expect(indices).toHaveLength(PIXELS);
    expect(Array.from(indices)).toEqual(expectedIndices());
  });

  it('only reads the view of a subarray', () => {
    const indices = applyPalette(subarrayOf(checker()), PALETTE);
    expect(indices).toHaveLength(PIXELS);
    expect(Array.from(indices)).toEqual(expectedIndices());
  });

  it('accepts a Uint8ClampedArray, as canvas ImageData produces', () => {
    const clamped = new Uint8ClampedArray(checker());
    expect(Array.from(applyPalette(clamped, PALETTE))).toEqual(expectedIndices());
  });
});

describe('quantize', () => {
  it('builds the palette from the view only, not from the bytes around it', () => {
    const palette = quantize(subarrayOf(checker()), 4);
    // The surrounding slab is filled with 0x7f, which would add a grey entry if it were read.
    expect(palette.map((color) => color.slice(0, 3))).toEqual(
      expect.arrayContaining([
        [255, 0, 0],
        [0, 0, 255],
      ]),
    );
    expect(palette).toHaveLength(2);
    expect(quantize(pooledBuffer(checker()), 4)).toHaveLength(2);
  });
});

describe('prequantize', () => {
  // Alpha 250 is already a multiple of the default alpha step, so only the colour channels move.
  const noisy = () => Uint8Array.from({ length: PIXELS * 4 }, (_, i) => (i % 4 === 3 ? 250 : 253));

  it('rounds colours in place on an owning array', () => {
    const rgba = noisy();
    prequantize(rgba, { roundRGB: 5 });
    expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 255, 255, 250]);
  });

  it('rounds a subarray in place and leaves the bytes around it alone', () => {
    const slab = new Uint8Array(PIXELS * 4 + 128).fill(253);
    slab.set(noisy(), 64);
    const view = slab.subarray(64, 64 + PIXELS * 4);
    prequantize(view, { roundRGB: 5 });
    expect(Array.from(view.subarray(0, 4))).toEqual([255, 255, 255, 250]);
    expect(slab.subarray(0, 64).every((byte) => byte === 253)).toBe(true);
    expect(slab.subarray(64 + PIXELS * 4).every((byte) => byte === 253)).toBe(true);
  });

  it('rounds a pooled Buffer in place', () => {
    const buffer = pooledBuffer(noisy());
    prequantize(buffer, { roundRGB: 5 });
    expect(Array.from(buffer.subarray(0, 4))).toEqual([255, 255, 255, 250]);
  });
});

describe('encoding frames from non-owning views', () => {
  it('produces the same GIF for a plain array, a pooled Buffer and a subarray', () => {
    function encode(rgba: Uint8Array): Uint8Array {
      const encoder = GIFEncoder();
      const palette = quantize(rgba, 4);
      encoder.writeFrame(applyPalette(rgba, palette), WIDTH, HEIGHT, { palette, delay: 100 });
      encoder.finish();
      return encoder.bytes();
    }
    const reference = encode(checker());
    expect(encode(pooledBuffer(checker()))).toEqual(reference);
    expect(encode(subarrayOf(checker()))).toEqual(reference);
  });
});
