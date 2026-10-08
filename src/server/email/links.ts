import 'server-only';
import { getEnv } from '@/server/env';

/**
 * Absolute links inside emails. They are built from APP_URL and nothing else, never from a request
 * header or user input, so a forged `Host` header cannot turn a reset email into a phishing link.
 */
export function appLink(path: `/${string}`, params: Readonly<Record<string, string>> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `${getEnv().APP_URL}${path}${query ? `?${query}` : ''}`;
}
