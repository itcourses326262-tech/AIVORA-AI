/**
 * Using a result as the input image of the next generation. An image output may be sent as
 * `inputAssetId` as it is; anything else (a video, which only has a still thumbnail) or an asset the
 * engine refuses is copied: the file is read from the media route and uploaded again as an input.
 */
import { ApiError } from '@/lib/api-client';
import type { AssetDTO } from '@/lib/api-types';
import { isAllowedImageType, uploadImage, type UploadImageOptions } from './upload';

/** Whether an asset can be sent as `inputAssetId` without a copy. */
export function usableAsInputDirectly(asset: Pick<AssetDTO, 'kind' | 'mimeType'>): boolean {
  return asset.kind === 'image' && isAllowedImageType(asset.mimeType);
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'image/*' } });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError('network_error', 0, 'Network request failed', undefined, undefined, {
      cause,
    });
  }
  if (!response.ok) return null;
  const blob = await response.blob();
  // The media route answers with the stored type; trust the header over the blob's guess.
  const type = (response.headers.get('content-type') ?? blob.type).split(';')[0]?.trim() ?? '';
  return isAllowedImageType(type) ? new Blob([blob], { type }) : null;
}

export interface CopyAsInputSource {
  id: string;
  /** Still picture of a video result; used when the file itself is not a usable image. */
  thumbUrl?: string;
  /** The file is known not to be an image (a video): do not download it just to find out. */
  skipOriginal?: boolean;
}

/**
 * Reads an asset (its still thumbnail when it is not an image the engine accepts) and uploads it as
 * an input image. Rejects with an `ApiError`: `not_found` when no picture could be read.
 */
export async function copyAssetAsInput(
  source: CopyAsInputSource,
  options: UploadImageOptions = {},
): Promise<AssetDTO> {
  const base = `/api/v1/media/${encodeURIComponent(source.id)}`;
  const thumb = source.thumbUrl ?? `${base}?variant=thumb`;
  const candidates = source.skipOriginal ? [thumb] : [base, thumb];
  for (const url of candidates) {
    const blob = await fetchImageBlob(url, options.signal);
    if (!blob) continue;
    const extension = EXTENSIONS[blob.type] ?? 'png';
    return uploadImage(new File([blob], `input.${extension}`, { type: blob.type }), options);
  }
  throw new ApiError('not_found', 404, 'No usable picture for this result');
}
