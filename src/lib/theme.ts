/**
 * Color theme preference. It lives in a cookie so the server can render `<html data-theme>` on the
 * first byte (no flash, no inline script). `system` follows `prefers-color-scheme` through CSS.
 */

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';
export const THEME_COOKIE = 'aivore_theme';

const THEME_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** A `Set-Cookie` / `document.cookie` string. Readable by scripts on purpose: it is a preference. */
export function serializeThemeCookie(theme: Theme, options: { secure?: boolean } = {}): string {
  const parts = [
    `${THEME_COOKIE}=${theme}`,
    'Path=/',
    `Max-Age=${THEME_COOKIE_MAX_AGE_SEC}`,
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
