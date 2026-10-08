/** Where the browser goes during and after a payment. */

export const RETURN_PATH = '/billing/return';

/** The page that reports how a payment went (`/billing/return?order=<id>`). */
export function returnPath(orderId: string): string {
  return `${RETURN_PATH}?order=${encodeURIComponent(orderId)}`;
}

/**
 * The address the buyer is sent to pay. It comes from our own server, but it still has to be a
 * page on this site or a secure (https) page of the gateway: anything else (a `javascript:` URL, a
 * plain-http foreign host) is refused rather than followed. Returns null when it is not safe.
 */
export function checkoutTarget(raw: string | undefined, currentOrigin: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, currentOrigin);
  } catch {
    return null;
  }
  if (url.protocol === 'https:' || url.origin === currentOrigin) return url.toString();
  return null;
}

/** Leaves the page for `url`. A function of its own so tests can observe the navigation. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
