// OWNER: storage
import 'server-only';

/** The only image types accepted for upload. */
export const UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

/**
 * Every type the media route will ever label a response with, and the extension its stored file
 * gets. Anything else is served as opaque bytes, never with a type a user could influence.
 */
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
} as const;

export type MediaMimeType = keyof typeof EXTENSIONS;

/** Lower-cases and drops parameters (`image/PNG; charset=x` -> `image/png`). */
export function normalizeMimeType(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

export function isMediaMimeType(value: string): value is MediaMimeType {
  return Object.hasOwn(EXTENSIONS, value);
}

/** The allowlisted type for a stored mime type, or null when it must not be served as itself. */
export function servableMimeType(value: string): MediaMimeType | null {
  const normalized = normalizeMimeType(value);
  return isMediaMimeType(normalized) ? normalized : null;
}

/** File extension without the dot for a stored mime type, e.g. `image/jpeg` -> `jpg`. */
export function extensionForMime(mimeType: string): string {
  const servable = servableMimeType(mimeType);
  return servable ? EXTENSIONS[servable] : 'bin';
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return (
    bytes.byteLength >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value)
  );
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const FTYP = [0x66, 0x74, 0x79, 0x70];
const QUICKTIME_BRAND = [0x71, 0x74, 0x20, 0x20];
const AVIF_BRAND = [0x61, 0x76, 0x69, 0x66];
const AVIS_BRAND = [0x61, 0x76, 0x69, 0x73];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

/** Atoms an ISO/QuickTime file may open with when it has no `ftyp` (old QuickTime movies). */
const LEADING_ATOMS = ['moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].map((name) =>
  Array.from(name, (letter) => letter.charCodeAt(0)),
);

/**
 * Whether the bytes open like an MP4/QuickTime file that has no `ftyp` box: a 32-bit size
 * (0 = to the end, 1 = 64-bit size follows, otherwise at least the 8-byte header) and then a known
 * leading atom. Used to believe a provider's `video/mp4` claim only for plausible containers.
 */
export function startsWithQuickTimeAtom(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const size = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (size !== 0 && size !== 1 && size < 8) return false;
  return LEADING_ATOMS.some((atom) => startsWith(bytes, atom, 4));
}

/**
 * Detects the real type from the magic bytes, ignoring the file name and the claimed content type.
 * Null for anything that is not PNG, JPEG or WebP.
 */
export function sniffImageType(bytes: Uint8Array): UploadMimeType | null {
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  return null;
}

/** Like {@link sniffImageType} for generated outputs: also GIF, MP4/MOV, WebM and AVIF. */
export function sniffMediaType(bytes: Uint8Array): MediaMimeType | null {
  const image = sniffImageType(bytes);
  if (image) return image;
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'image/gif';
  if (startsWith(bytes, EBML)) return 'video/webm';
  if (startsWith(bytes, FTYP, 4)) {
    if (startsWith(bytes, AVIF_BRAND, 8) || startsWith(bytes, AVIS_BRAND, 8)) return 'image/avif';
    return startsWith(bytes, QUICKTIME_BRAND, 8) ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}
