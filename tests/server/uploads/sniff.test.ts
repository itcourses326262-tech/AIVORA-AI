import { describe, expect, it } from 'vitest';
import {
  extensionForMime,
  normalizeMimeType,
  servableMimeType,
  sniffImageType,
  sniffMediaType,
  startsWithQuickTimeAtom,
} from '@/server/uploads/sniff';
import { TINY_GIF, TINY_PNG } from '../../helpers/fakes';
import { SVG, fakeMp4, makeJpeg, makeWebp, utf8 } from './support';

describe('sniffImageType', () => {
  it('recognises PNG, JPEG and WebP by their bytes', async () => {
    expect(sniffImageType(TINY_PNG)).toBe('image/png');
    expect(sniffImageType(await makeJpeg())).toBe('image/jpeg');
    expect(sniffImageType(await makeWebp())).toBe('image/webp');
  });

  it.each([
    ['GIF', TINY_GIF],
    ['SVG', SVG],
    ['HTML', utf8('<!doctype html><script>alert(1)</script>')],
    ['PHP', utf8('<?php system($_GET["c"]); ?>')],
    ['BMP', utf8('BM......')],
    ['PDF', utf8('%PDF-1.7')],
    ['HEIC', new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])],
    ['an empty file', new Uint8Array(0)],
    ['one byte', new Uint8Array([0xff])],
    ['a RIFF that is not WebP', utf8('RIFF\0\0\0\0WAVEfmt ')],
    ['a truncated PNG signature', TINY_PNG.subarray(0, 7)],
  ])('refuses %s', (_name, bytes) => {
    expect(sniffImageType(bytes)).toBeNull();
  });

  it('ignores everything but the bytes: a PNG named .svg is still a PNG', () => {
    expect(sniffImageType(TINY_PNG)).toBe('image/png');
  });
});

describe('sniffMediaType', () => {
  it('adds GIF, MP4, QuickTime, WebM and AVIF for generated outputs', () => {
    expect(sniffMediaType(TINY_GIF)).toBe('image/gif');
    expect(sniffMediaType(fakeMp4())).toBe('video/mp4');
    expect(sniffMediaType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]))).toBe('video/webm');
    const header = (brand: string) =>
      new Uint8Array([0, 0, 0, 0x18, ...utf8('ftyp'), ...utf8(brand)]);
    expect(sniffMediaType(header('qt  '))).toBe('video/quicktime');
    expect(sniffMediaType(header('avif'))).toBe('image/avif');
    expect(sniffMediaType(header('avis'))).toBe('image/avif');
    expect(sniffMediaType(TINY_PNG)).toBe('image/png');
  });

  it('refuses text, SVG and unknown data', () => {
    expect(sniffMediaType(SVG)).toBeNull();
    expect(sniffMediaType(utf8('hello world'))).toBeNull();
    expect(sniffMediaType(new Uint8Array(0))).toBeNull();
  });
});

describe('startsWithQuickTimeAtom', () => {
  const atom = (size: number[], type: string) =>
    new Uint8Array([...size, ...utf8(type), ...utf8('payload')]);

  it('accepts a known leading atom after a plausible size', () => {
    for (const type of ['moov', 'mdat', 'free', 'wide', 'skip', 'pnot']) {
      expect(startsWithQuickTimeAtom(atom([0, 0, 0, 0x20], type))).toBe(true);
    }
    // 0 means "to the end of the file", 1 means a 64-bit size follows.
    expect(startsWithQuickTimeAtom(atom([0, 0, 0, 0], 'mdat'))).toBe(true);
    expect(startsWithQuickTimeAtom(atom([0, 0, 0, 1], 'mdat'))).toBe(true);
  });

  it('refuses text, other atoms, impossible sizes and short input', () => {
    expect(startsWithQuickTimeAtom(utf8('<html><body>nope</body></html>'))).toBe(false);
    expect(startsWithQuickTimeAtom(utf8('{"error":"quota exceeded"}'))).toBe(false);
    expect(startsWithQuickTimeAtom(atom([0, 0, 0, 0x20], 'trak'))).toBe(false);
    expect(startsWithQuickTimeAtom(atom([0, 0, 0, 4], 'moov'))).toBe(false);
    expect(startsWithQuickTimeAtom(new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f]))).toBe(false);
    expect(startsWithQuickTimeAtom(new Uint8Array(0))).toBe(false);
  });
});

describe('mime helpers', () => {
  it('maps stored mime types to extensions', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('image/gif')).toBe('gif');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('video/webm')).toBe('webm');
    expect(extensionForMime('IMAGE/PNG; charset=binary')).toBe('png');
  });

  it('never invents an extension for an unknown type', () => {
    for (const mime of ['', 'text/html', 'image/svg+xml', '../../etc/passwd', 'application/zip']) {
      expect(extensionForMime(mime)).toBe('bin');
    }
  });

  it('only servable types are allowlisted', () => {
    expect(servableMimeType('image/png')).toBe('image/png');
    expect(servableMimeType('Video/MP4')).toBe('video/mp4');
    for (const mime of [
      'text/html',
      'image/svg+xml',
      'application/javascript',
      '',
      'image/png\r\nx: y',
    ]) {
      expect(servableMimeType(mime)).toBeNull();
    }
    expect(normalizeMimeType(' Image/WebP ; q=1')).toBe('image/webp');
  });
});
