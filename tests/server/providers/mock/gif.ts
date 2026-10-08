/** A tiny GIF89a walker: enough to check structure (size, frames, loop, delays) without decoding pixels. */

export interface GifInfo {
  signature: string;
  width: number;
  height: number;
  hasGlobalColorTable: boolean;
  globalColorTableSize: number;
  frameCount: number;
  /** Loop count from the NETSCAPE2.0 extension (0 = forever); undefined when the extension is absent. */
  loopCount: number | undefined;
  /** Per-frame delays in milliseconds. */
  delaysMs: number[];
  localColorTables: number;
  endsWithTrailer: boolean;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let cursor = start;
  for (;;) {
    const size = bytes[cursor];
    if (size === undefined) throw new Error('GIF ended inside a data block');
    cursor += 1;
    if (size === 0) return cursor;
    cursor += size;
  }
}

export function parseGif(bytes: Uint8Array): GifInfo {
  const text = (from: number, length: number) =>
    String.fromCharCode(...bytes.subarray(from, from + length));
  const signature = text(0, 6);
  if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error(`Not a GIF: ${signature}`);
  const u16 = (at: number) => (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
  const width = u16(6);
  const height = u16(8);
  const packed = bytes[10] as number;
  const hasGlobalColorTable = (packed & 0x80) !== 0;
  const globalColorTableSize = hasGlobalColorTable ? 2 ** ((packed & 7) + 1) : 0;
  let cursor = 13 + globalColorTableSize * 3;

  const info: GifInfo = {
    signature,
    width,
    height,
    hasGlobalColorTable,
    globalColorTableSize,
    frameCount: 0,
    loopCount: undefined,
    delaysMs: [],
    localColorTables: 0,
    endsWithTrailer: false,
  };

  for (;;) {
    const marker = bytes[cursor];
    if (marker === undefined) throw new Error('GIF ended without a trailer');
    if (marker === 0x3b) {
      info.endsWithTrailer = cursor === bytes.length - 1;
      return info;
    }
    if (marker === 0x21) {
      const label = bytes[cursor + 1] as number;
      if (label === 0xf9) info.delaysMs.push(u16(cursor + 4) * 10);
      if (label === 0xff && text(cursor + 3, 11) === 'NETSCAPE2.0') {
        info.loopCount = u16(cursor + 16);
      }
      cursor = skipSubBlocks(bytes, cursor + 2);
      continue;
    }
    if (marker === 0x2c) {
      const descriptor = bytes[cursor + 9] as number;
      cursor += 10;
      if (descriptor & 0x80) {
        info.localColorTables += 1;
        cursor += 3 * 2 ** ((descriptor & 7) + 1);
      }
      cursor = skipSubBlocks(bytes, cursor + 1); // LZW minimum code size, then the pixel data
      info.frameCount += 1;
      continue;
    }
    throw new Error(`Unexpected GIF block 0x${marker.toString(16)} at ${cursor}`);
  }
}
