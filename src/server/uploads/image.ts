// OWNER: storage — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { UploadMimeType } from './sniff';

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

/**
 * Decodes an upload with sharp under a pixel limit (decompression bombs and polyglots are
 * `bad_request`), strips metadata including EXIF and scales anything above 4096 px down.
 */
export async function normalizeUpload(_bytes: Uint8Array): Promise<NormalizedImage> {
  throw new NotImplementedError('uploads.normalizeUpload');
}

/** Dimensions and format of an image the server produced or downloaded itself. */
export async function probeImage(_bytes: Uint8Array): Promise<ImageInfo> {
  throw new NotImplementedError('uploads.probeImage');
}

/** A small WebP preview for gallery grids. */
export async function makeThumbnail(_bytes: Uint8Array): Promise<Thumbnail> {
  throw new NotImplementedError('uploads.makeThumbnail');
}
