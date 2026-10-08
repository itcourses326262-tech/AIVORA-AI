/**
 * The deployment's origin as a URL, for Next's `metadataBase`. Undefined when `appUrl` is missing
 * or not an http(s) URL: a bad value must not take the metadata of every page down with it, the
 * pages then simply keep relative URLs.
 */
export function metadataBaseFor(appUrl: string | undefined): URL | undefined {
  if (!appUrl) return undefined;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return new URL(url.origin);
  } catch {
    return undefined;
  }
}
