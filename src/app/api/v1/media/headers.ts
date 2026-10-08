import { extensionForMime } from '@/server/uploads/sniff';
import type { VisibleAsset } from './access';

export type Variant = 'original' | 'thumb';

/** Owners get a private cache; shared output is cacheable by anyone, but only briefly. */
const OWNER_CACHE_CONTROL = 'private, max-age=3600';
const PUBLIC_CACHE_CONTROL = 'public, max-age=300';

export interface MediaHeaderInput {
  asset: VisibleAsset['asset'];
  access: VisibleAsset['access'];
  variant: Variant;
  /** Already an allowlisted type (or `application/octet-stream`); never taken from a request. */
  contentType: string;
  attachment: boolean;
}

/** Assets never change once written, so the id and variant identify the bytes. */
export function etagFor(assetId: string, variant: Variant): string {
  return `"${assetId}-${variant}"`;
}

/** Headers that belong on every answer about the asset, including 304 and 416. */
export function validatorHeaders({ asset, access, variant }: MediaHeaderInput): Headers {
  const headers = new Headers({
    ETag: etagFor(asset.id, variant),
    'Cache-Control': access === 'owner' ? OWNER_CACHE_CONTROL : PUBLIC_CACHE_CONTROL,
    // Only a response that depends on who asked needs to be keyed by credentials.
    'Cross-Origin-Resource-Policy': access === 'owner' ? 'same-origin' : 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (access === 'owner') headers.set('Vary', 'Cookie, Authorization');
  return headers;
}

/** Headers of a response that carries (or, for HEAD, would carry) the file. */
export function contentHeaders(input: MediaHeaderInput): Headers {
  const headers = validatorHeaders(input);
  headers.set('Content-Type', input.contentType);
  headers.set('Accept-Ranges', input.variant === 'thumb' ? 'none' : 'bytes');
  headers.set('Content-Disposition', disposition(input));
  return headers;
}

/** `aivore-image-<8 chars of the id>.<ext>`: built from our own data, never from user text. */
function disposition({ asset, variant, contentType, attachment }: MediaHeaderInput): string {
  if (!attachment) return 'inline';
  const extension = variant === 'thumb' ? 'webp' : extensionForMime(contentType);
  return `attachment; filename="aivore-${asset.kind}-${asset.id.slice(-8)}.${extension}"`;
}

/** Weak comparison, as required for `If-None-Match`; `*` matches anything that exists. */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const strip = (value: string) => value.trim().replace(/^W\//, '');
  return header
    .split(',')
    .some((candidate) => candidate.trim() === '*' || strip(candidate) === etag);
}
