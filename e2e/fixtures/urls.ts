/** The studio keeps its tool and model in the query string, so only the path says where you are. */
export const STUDIO_URL = /\/studio(?:\?.*)?$/;

/** Matches exactly this site's `path` (any query string), so another origin can never pass. */
export function sitePath(baseURL: string | undefined, path: string): RegExp {
  const origin = new URL(baseURL ?? 'http://localhost').origin.replace(
    /[.*+?^${}()|[\]\\/]/g,
    '\\$&',
  );
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`^${origin}${escaped}(?:\\?.*)?$`);
}
