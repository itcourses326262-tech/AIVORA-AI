import 'server-only';
import sharp, { type Sharp } from 'sharp';
import { ProviderError } from '../errors';

/** Uploads are normalised to 4096 px by the storage module (16.8 MP); anything far beyond is not ours. */
const MAX_INPUT_PIXELS = 40_000_000;

/** A sharp pipeline over user-provided bytes, with a decompression-bomb guard. */
export function openInputImage(bytes: Uint8Array): Sharp {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
}

/** Wraps a decoder failure: the demo cannot do anything with bytes that are not an image. */
export function invalidInputImage(cause: unknown): ProviderError {
  return new ProviderError('invalid_input', 'The input image could not be decoded', {
    cause,
    userMessage: 'The input image could not be read. Try a different PNG, JPEG or WebP file.',
  });
}

export interface RawImage {
  /** RGBA, `width * height * 4` bytes. */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decodes to RGBA at the given size (`fit` is always fill: callers pick a size with the right
 * proportions), honouring EXIF orientation and flattening transparency onto a dark backdrop.
 */
export async function decodeToRaw(
  bytes: Uint8Array,
  size: { width: number; height: number },
  options: { flatten: boolean },
): Promise<RawImage> {
  try {
    let pipeline = openInputImage(bytes).rotate();
    if (options.flatten) pipeline = pipeline.flatten({ background: { r: 12, g: 12, b: 20 } });
    const { data, info } = await pipeline
      .resize(size.width, size.height, { fit: 'fill', kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    throw invalidInputImage(error);
  }
}

/** Width and height as displayed (after EXIF rotation). */
export async function probeDisplaySize(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  try {
    const meta = await openInputImage(bytes).metadata();
    if (!meta.width || !meta.height) throw new Error('image has no dimensions');
    const swapped = (meta.orientation ?? 1) >= 5;
    return swapped
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };
  } catch (error) {
    throw invalidInputImage(error);
  }
}
