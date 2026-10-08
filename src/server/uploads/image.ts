// OWNER: storage
import 'server-only';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { AppError } from '@/lib/errors';
import { sniffImageType, type UploadMimeType } from './sniff';
import { inspectStructure, type StructureProblem } from './structure';

/** Longest side of a stored upload; bigger images are scaled down to fit. */
export const MAX_UPLOAD_DIMENSION = 4096;
/** Decoded size limit for uploads (about 7000 x 7000): what separates photos from decompression bombs. */
export const MAX_UPLOAD_PIXELS = 50_000_000;
/** Header and thumbnail limit for outputs that came from a provider rather than a user. */
export const MAX_OUTPUT_PIXELS = 128_000_000;
/** Longest side of the gallery thumbnail. */
export const THUMBNAIL_DIMENSION = 512;

export interface ImageInfo {
  width: number;
  height: number;
  mimeType: string;
}

export interface NormalizedImage {
  bytes: Uint8Array;
  mimeType: UploadMimeType;
  width: number;
  height: number;
}

export interface Thumbnail {
  /** WebP. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

export type ImageRejection = StructureProblem | 'dimensions' | 'unsupported';

const REJECTION_MESSAGES: Record<ImageRejection, string> = {
  truncated: 'The image file is incomplete',
  trailing_data: 'The file contains extra data after the image',
  animated: 'Animated images are not supported',
  corrupt: 'The file is not a valid image',
  dimensions: 'The image has too many pixels',
  unsupported: 'This image format is not supported',
};

function reject(reason: ImageRejection): AppError {
  return AppError.of('bad_request', REJECTION_MESSAGES[reason], { reason });
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Maps whatever sharp threw to a client error that names the cause but not the library. */
function decodeFailure(error: unknown): AppError {
  const message = error instanceof Error ? error.message : '';
  return reject(/pixel limit/i.test(message) ? 'dimensions' : 'corrupt');
}

function mimeTypeOf(meta: Metadata): string | null {
  switch (meta.format) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    // Only AV1 in a HEIF container is AVIF; HEIC (HEVC) is not something browsers display.
    case 'heif':
      return meta.compression === 'av1' ? 'image/avif' : null;
    default:
      return null;
  }
}

const EXPECTED_FORMAT: Record<UploadMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

function encode(pipeline: Sharp, type: UploadMimeType): Sharp {
  switch (type) {
    case 'image/png':
      return pipeline.png();
    case 'image/jpeg':
      return pipeline.jpeg({ quality: 90 });
    case 'image/webp':
      return pipeline.webp({ quality: 90 });
  }
}

/**
 * Decodes an upload with sharp under a pixel limit (decompression bombs and polyglots are
 * `bad_request`), strips metadata including EXIF and scales anything above 4096 px down.
 *
 * Nothing of the original file survives: pixels are decoded and encoded again, so trailing data,
 * embedded payloads, EXIF/GPS, XMP and thumbnails are gone. The EXIF orientation is applied to the
 * pixels first, so the picture still looks right without the tag.
 */
export async function normalizeUpload(bytes: Uint8Array): Promise<NormalizedImage> {
  const type = sniffImageType(bytes);
  if (!type) {
    throw AppError.of('unsupported_media_type', 'Only PNG, JPEG and WebP images are accepted');
  }
  const problem = inspectStructure(bytes, type);
  if (problem) throw reject(problem);

  try {
    // 'error' also aborts on truncated data; 'warning' would additionally refuse photos whose
    // only flaw is a benign decoder warning (an odd colour profile, stray padding bytes).
    const source = sharp(asBuffer(bytes), {
      limitInputPixels: MAX_UPLOAD_PIXELS,
      failOn: 'error',
    });
    const meta = await source.metadata();
    if (meta.format !== EXPECTED_FORMAT[type]) throw reject('corrupt');
    if ((meta.pages ?? 1) > 1) throw reject('animated');
    const { data, info } = await encode(
      source.rotate().resize({
        width: MAX_UPLOAD_DIMENSION,
        height: MAX_UPLOAD_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      }),
      type,
    ).toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), mimeType: type, width: info.width, height: info.height };
  } catch (error) {
    throw error instanceof AppError ? error : decodeFailure(error);
  }
}

/**
 * Dimensions (as displayed, so EXIF rotation is applied) and real format of an image the server
 * produced or downloaded itself. Only formats a browser can show are accepted: SVG, PDF, TIFF and
 * friends are `bad_request` even though sharp can read them.
 */
export async function probeImage(bytes: Uint8Array): Promise<ImageInfo> {
  try {
    const meta = await sharp(asBuffer(bytes), {
      limitInputPixels: MAX_OUTPUT_PIXELS,
      failOn: 'error',
    }).metadata();
    const mimeType = mimeTypeOf(meta);
    if (!mimeType) throw reject('unsupported');
    if (!meta.width || !meta.height) throw reject('corrupt');
    const rotated = (meta.orientation ?? 1) >= 5;
    return {
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      mimeType,
    };
  } catch (error) {
    throw error instanceof AppError ? error : decodeFailure(error);
  }
}

/** A small WebP preview for gallery grids (the first frame of an animation). */
export async function makeThumbnail(bytes: Uint8Array): Promise<Thumbnail> {
  try {
    const { data, info } = await sharp(asBuffer(bytes), {
      limitInputPixels: MAX_OUTPUT_PIXELS,
      failOn: 'error',
    })
      .rotate()
      .resize({
        width: THUMBNAIL_DIMENSION,
        height: THUMBNAIL_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  } catch (error) {
    throw error instanceof AppError ? error : decodeFailure(error);
  }
}
