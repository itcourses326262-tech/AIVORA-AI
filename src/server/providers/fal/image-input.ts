import 'server-only';
import sharp from 'sharp';
import { ProviderError } from '../errors';
import type { ProviderInput } from '../types';

/*
 * fal accepts a file wherever a model takes a URL as either a URL or a base64 data URI ("some
 * models" per the fal CDN docs; the model pages we read for the endpoints in this catalog say so),
 * so the engine's already validated upload is sent inline and no upload to fal's CDN is needed.
 * The cost is request size, hence the byte cap. Several models also bound the input size (Wan
 * 360-2000 px per side, Veo 8 MB) and FLUX bills by output megapixels, which follow the input
 * image, so the image is shrunk to what the model and our price assume.
 */

export type InputImage = NonNullable<ProviderInput['inputImage']>;

export interface ImageRules {
  /** Longest allowed side in pixels. */
  maxSide: number;
  /** Shortest allowed side; a smaller image is enlarged. */
  minSide?: number;
  /** Largest allowed area. */
  maxPixels?: number;
  /** Both sides are rounded down to a multiple of this. */
  multipleOf?: number;
  /** Cap on the encoded file. */
  maxBytes: number;
  /** The model rejects transparency: flatten onto white. */
  opaque?: boolean;
}

const PASS_THROUGH_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const JPEG_QUALITIES = [90, 82, 72, 60] as const;
const MAX_SHRINK_ROUNDS = 4;

const unusable = (cause?: unknown) =>
  new ProviderError('invalid_input', 'The input image could not be processed', {
    userMessage: 'The input image could not be processed. Try a different image.',
    ...(cause === undefined ? {} : { cause }),
  });

function snap(value: number, multipleOf: number): number {
  return Math.max(multipleOf, Math.floor(value / multipleOf) * multipleOf);
}

/** The size the image must be resized to, or undefined when it already fits the rules. */
export function targetSize(
  width: number,
  height: number,
  rules: ImageRules,
): { width: number; height: number } | undefined {
  const multipleOf = rules.multipleOf ?? 1;
  let scale = Math.min(
    1,
    rules.maxSide / Math.max(width, height),
    rules.maxPixels === undefined ? 1 : Math.sqrt(rules.maxPixels / (width * height)),
  );
  if (rules.minSide !== undefined && Math.min(width, height) * scale < rules.minSide) {
    // Enlarging wins over the pixel budget, but never past the longest allowed side.
    const wanted = rules.minSide / Math.min(width, height);
    scale = Math.min(wanted, rules.maxSide / Math.max(width, height));
  }
  const next = {
    width: snap(width * scale, multipleOf),
    height: snap(height * scale, multipleOf),
  };
  return next.width === width && next.height === height ? undefined : next;
}

async function encode(
  bytes: Uint8Array,
  size: { width: number; height: number } | undefined,
  quality: number,
): Promise<Uint8Array> {
  let pipeline = sharp(bytes, { failOn: 'error' }).rotate();
  if (size) pipeline = pipeline.resize(size.width, size.height, { fit: 'fill' });
  const out = await pipeline
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Returns the image as it should be sent: untouched when it already satisfies the rules,
 * otherwise resized (and re-encoded as JPEG, flattened onto white) until it does.
 */
export async function prepareImage(
  image: InputImage,
  rules: ImageRules,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  try {
    const meta = await sharp(image.bytes).metadata();
    const { width, height } = meta;
    if (!width || !height) throw unusable();

    const size = targetSize(width, height, rules);
    const needsFlatten = rules.opaque === true && meta.hasAlpha === true;
    const fits = image.bytes.byteLength <= rules.maxBytes;
    if (!size && !needsFlatten && fits && PASS_THROUGH_TYPES.has(image.mimeType)) {
      return { bytes: image.bytes, mimeType: image.mimeType };
    }

    let current = size ?? { width, height };
    let bytes = await encode(image.bytes, size, JPEG_QUALITIES[0]);
    for (
      let round = 0;
      bytes.byteLength > rules.maxBytes && round < MAX_SHRINK_ROUNDS;
      round += 1
    ) {
      const quality = JPEG_QUALITIES[Math.min(round + 1, JPEG_QUALITIES.length - 1)] as number;
      current = {
        width: snap(current.width * 0.8, rules.multipleOf ?? 1),
        height: snap(current.height * 0.8, rules.multipleOf ?? 1),
      };
      bytes = await encode(image.bytes, current, quality);
    }
    if (bytes.byteLength > rules.maxBytes) {
      throw new ProviderError('invalid_input', 'The input image is too large after resizing', {
        userMessage: 'The input image is too large. Try a smaller image.',
      });
    }
    return { bytes, mimeType: 'image/jpeg' };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw unusable(error);
  }
}

export function toDataUri(image: { bytes: Uint8Array; mimeType: string }): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`;
}

/** The input image of a request, prepared and encoded as a data URI. */
export async function inputImageDataUri(input: ProviderInput, rules: ImageRules): Promise<string> {
  if (!input.inputImage) {
    throw new ProviderError('invalid_input', `${input.tool} needs an input image`, {
      userMessage: 'This tool needs an input image.',
    });
  }
  return toDataUri(await prepareImage(input.inputImage, rules));
}
