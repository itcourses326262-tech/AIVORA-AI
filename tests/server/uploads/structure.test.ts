import { describe, expect, it } from 'vitest';
import { inspectStructure } from '@/server/uploads/structure';
import { concat, makeAnimatedWebp, makeApng, makeJpeg, makePng, makeWebp, utf8 } from './support';

describe('inspectStructure', () => {
  it('passes complete single-frame files of every type', async () => {
    expect(inspectStructure(await makePng(), 'image/png')).toBeNull();
    expect(inspectStructure(await makeJpeg(), 'image/jpeg')).toBeNull();
    expect(inspectStructure(await makeWebp(), 'image/webp')).toBeNull();
  });

  it('finds data after the end of each format', async () => {
    const tail = utf8('<script>1</script>');
    expect(inspectStructure(concat(await makePng(), tail), 'image/png')).toBe('trailing_data');
    expect(inspectStructure(concat(await makeJpeg(), tail), 'image/jpeg')).toBe('trailing_data');
    expect(inspectStructure(concat(await makeWebp(), tail), 'image/webp')).toBe('trailing_data');
  });

  it('allows NUL padding only', async () => {
    const pad = new Uint8Array(32);
    expect(inspectStructure(concat(await makePng(), pad), 'image/png')).toBeNull();
    expect(inspectStructure(concat(await makeJpeg(), pad), 'image/jpeg')).toBeNull();
    expect(inspectStructure(concat(await makeWebp(), pad), 'image/webp')).toBeNull();
    const almost = new Uint8Array(32);
    almost[31] = 1;
    expect(inspectStructure(concat(await makePng(), almost), 'image/png')).toBe('trailing_data');
  });

  it('reports truncation at every cut point of a small file', async () => {
    for (const [type, bytes] of [
      ['image/png', await makePng(8, 8)],
      ['image/jpeg', await makeJpeg(8, 8)],
      ['image/webp', await makeWebp(8, 8)],
    ] as const) {
      for (let cut = 12; cut < bytes.length; cut += 1) {
        const problem = inspectStructure(bytes.slice(0, cut), type);
        expect(problem, `${type} cut at ${cut}`).not.toBeNull();
        expect(problem === 'truncated' || problem === 'corrupt').toBe(true);
      }
    }
  });

  it('detects animation in PNG and WebP', async () => {
    expect(inspectStructure(await makeApng(), 'image/png')).toBe('animated');
    expect(inspectStructure(await makeAnimatedWebp(), 'image/webp')).toBe('animated');
  });

  it('rejects a PNG whose first chunk is not IHDR', async () => {
    const png = Buffer.from(await makePng(8, 8));
    png.write('XXXX', 12, 'latin1');
    expect(inspectStructure(new Uint8Array(png), 'image/png')).toBe('corrupt');
  });

  it('rejects a JPEG with bytes where a marker should be', () => {
    expect(
      inspectStructure(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0x41, 0x42]), 'image/jpeg'),
    ).toBe('corrupt');
  });

  it('rejects a WebP that declares an impossible size', async () => {
    const webp = Buffer.from(await makeWebp());
    webp.writeUInt32LE(2, 4);
    expect(inspectStructure(new Uint8Array(webp), 'image/webp')).toBe('corrupt');
  });
});
