// OWNER: storage
import 'server-only';
import type { UploadMimeType } from './sniff';

/**
 * What is wrong with a file's container, found without decoding pixels:
 * - `truncated`: the data ends before the format says it should.
 * - `trailing_data`: bytes follow the end of the image (the classic polyglot shape: a valid
 *   picture with a script, archive or second file appended).
 * - `animated`: more than one frame (APNG, animated WebP).
 * - `corrupt`: the container is not well formed.
 */
export type StructureProblem = 'truncated' | 'trailing_data' | 'animated' | 'corrupt';

const PNG_SIGNATURE_LENGTH = 8;
const PNG_CHUNK_OVERHEAD = 12;
const MAX_PNG_CHUNK_LENGTH = 0x7fffffff;

function isPadding(bytes: Buffer, from: number): boolean {
  for (let index = from; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function checkPng(bytes: Buffer): StructureProblem | null {
  let offset = PNG_SIGNATURE_LENGTH;
  let first = true;
  for (;;) {
    if (offset + PNG_CHUNK_OVERHEAD > bytes.length) return 'truncated';
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (length > MAX_PNG_CHUNK_LENGTH || (first && type !== 'IHDR')) return 'corrupt';
    first = false;
    const next = offset + PNG_CHUNK_OVERHEAD + length;
    if (next > bytes.length) return 'truncated';
    if (type === 'acTL') return 'animated';
    if (type === 'IEND') return isPadding(bytes, next) ? null : 'trailing_data';
    offset = next;
  }
}

/** Offset just past the first image's EOI marker, or a problem when it cannot be found. */
function jpegEnd(bytes: Buffer): number | StructureProblem {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return 'corrupt';
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) return 'truncated';
    if (marker === 0xd9) return offset;
    // Markers without a payload: TEM and RST0-7.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return 'truncated';
    const length = bytes.readUInt16BE(offset);
    if (length < 2) return 'corrupt';
    offset += length;
    if (offset > bytes.length) return 'truncated';
    if (marker !== 0xda) continue;
    // Entropy-coded scan data: runs until a marker that is not a stuffed 0xFF00 or a restart.
    for (;;) {
      offset = bytes.indexOf(0xff, offset);
      if (offset === -1 || offset + 1 >= bytes.length) return 'truncated';
      const next = bytes[offset + 1] as number;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) offset += 2;
      else if (next === 0xff) offset += 1;
      else break;
    }
  }
  return 'truncated';
}

function checkJpeg(bytes: Buffer): StructureProblem | null {
  const end = jpegEnd(bytes);
  if (typeof end === 'string') return end;
  if (end === bytes.length || isPadding(bytes, end)) return null;
  // Phones append further pictures (gain maps, multi-picture files) that start with their own SOI.
  const appendedPicture = bytes[end] === 0xff && bytes[end + 1] === 0xd8 && bytes[end + 2] === 0xff;
  return appendedPicture ? null : 'trailing_data';
}

const WEBP_HEADER_LENGTH = 12;
const WEBP_CHUNK_HEADER = 8;

function checkWebp(bytes: Buffer): StructureProblem | null {
  if (bytes.length < WEBP_HEADER_LENGTH + WEBP_CHUNK_HEADER) return 'truncated';
  const declared = bytes.readUInt32LE(4) + WEBP_CHUNK_HEADER;
  if (declared < WEBP_HEADER_LENGTH + WEBP_CHUNK_HEADER) return 'corrupt';
  if (declared > bytes.length) return 'truncated';
  let offset = WEBP_HEADER_LENGTH;
  while (offset + WEBP_CHUNK_HEADER <= declared) {
    const type = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    // VP8X flag bit 1 announces an animation; ANIM/ANMF chunks are the animation itself.
    if (type === 'ANIM' || type === 'ANMF') return 'animated';
    if (type === 'VP8X' && ((bytes[offset + WEBP_CHUNK_HEADER] ?? 0) & 0x02) !== 0) {
      return 'animated';
    }
    offset += WEBP_CHUNK_HEADER + size + (size & 1);
  }
  if (offset > declared + 1) return 'truncated';
  return isPadding(bytes, declared) ? null : 'trailing_data';
}

/**
 * Cheap structural checks on a sniffed upload: one frame, complete, and nothing after the image.
 * Pixels are not decoded here; sharp does that afterwards.
 */
export function inspectStructure(bytes: Uint8Array, type: UploadMimeType): StructureProblem | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type) {
    case 'image/png':
      return checkPng(buffer);
    case 'image/jpeg':
      return checkJpeg(buffer);
    case 'image/webp':
      return checkWebp(buffer);
  }
}
