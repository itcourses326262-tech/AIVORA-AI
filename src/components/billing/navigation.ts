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
export function checkoutTarget(raw: string | undefined, origin: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.protocol === 'https:' || url.origin === origin) return url.toString();
  return null;
}

/** The page's own origin; empty outside a browser, where no address counts as safe. */
export function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Leaves the page for `url`. A function of its own so tests can observe the navigation. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
