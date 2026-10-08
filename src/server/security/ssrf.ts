// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

export interface SafeFetchOptions {
  /** Hard cap on the response body; the download is aborted as soon as it is exceeded. */
  maxBytes: number;
  /** Total time budget for the request including redirects and the body. */
  timeoutMs: number;
  /** Accepted response `Content-Type`s, matched on the media type; `image/*` style wildcards allowed. */
  allowedContentTypes: readonly string[];
  /** Aborts the download early (for example when a generation is canceled). */
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  /** Media type of the response without parameters, e.g. `image/png`. */
  contentType: string;
  /** URL after redirects. */
  finalUrl: string;
}

/**
 * Parses `url` and rejects (`bad_request`) anything but public HTTPS: resolves DNS and blocks
 * private, loopback, link-local and cloud-metadata ranges, and credentials in the URL.
 */
export async function assertPublicHttpsUrl(_url: string | URL): Promise<URL> {
  throw new NotImplementedError('security.assertPublicHttpsUrl');
}

/**
 * The only way the server downloads a URL it did not choose (provider outputs). Every redirect hop
 * is re-validated with {@link assertPublicHttpsUrl}; the body is size- and content-type-limited.
 */
export async function safeFetch(
  _url: string,
  _options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  throw new NotImplementedError('security.safeFetch');
}
