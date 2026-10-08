import Database from 'better-sqlite3';
import gifenc from 'gifenc';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

// Guards the runtime interop of the native / CommonJS dependencies: if a bundler, loader or
// dependency upgrade breaks one of these imports, this fails before any feature code does.
describe('native dependencies', () => {
  it('opens an in-memory SQLite database with better-sqlite3', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('SELECT 1 + 1 AS two').get()).toEqual({ two: 2 });
    db.close();
  });

  it('decodes and encodes images with sharp', async () => {
    const png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#7c3aed' },
    })
      .png()
      .toBuffer();
    const meta = await sharp(png).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 4, height: 3 });
  });

  it('writes an animated GIF with gifenc via the default import', () => {
    const { GIFEncoder, quantize, applyPalette } = gifenc;
    const width = 4;
    const height = 4;
    const encoder = GIFEncoder();
    for (const shade of [0, 255]) {
      const rgba = new Uint8Array(width * height * 4).fill(shade);
      const palette = quantize(rgba, 4);
      encoder.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 100 });
    }
    encoder.finish();
    const bytes = encoder.bytes();
    expect(Buffer.from(bytes.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
  });
});
