/**
 * Post-login redirects. `?next=` comes from the URL, so it is untrusted: only same-site absolute
 * paths are followed (never `//evil.example`, `https://…` or `/\evil.example`).
 */

export const DEFAULT_NEXT_PATH = '/studio';

/** The path to go to after logging in: `raw` when it is a safe local path, else the fallback. */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  if (!raw || raw.length > 2048) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  // Control characters (a tab or newline inside "/\t/evil") are stripped by URL parsers.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  // Never bounce between the auth pages themselves.
  if (/^\/(?:login|register)(?:[/?#]|$)/.test(raw)) return fallback;
  return raw;
}

/** `/login?next=<path>`; a path that is not safe is left out, so the user lands on the default page. */
export function loginUrl(nextPath?: string | null): string {
  const safe = safeNextPath(nextPath, '');
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}
