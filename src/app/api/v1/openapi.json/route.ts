import { createHash } from 'node:crypto';
import { OPENAPI_RATE_LIMIT } from '@/lib/openapi/rate-limit';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import { getEnv } from '@/server/env';
import { route } from '@/server/http/route';

export const runtime = 'nodejs';
// The server URL inside the document is the origin of APP_URL, read when the request arrives.
export const dynamic = 'force-dynamic';

interface Rendered {
  body: string;
  etag: string;
}

const rendered = new Map<string, Rendered>();

function render(origin: string): Rendered {
  const cached = rendered.get(origin);
  if (cached) return cached;
  const body = JSON.stringify(buildOpenApiDocument(origin));
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  const result = { body, etag };
  rendered.set(origin, result);
  return result;
}

/** `If-None-Match` may list several tags and mark them weak; any match counts. */
function hasEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

/**
 * `GET /api/v1/openapi.json`: the OpenAPI 3.1 description of the developer API. Public (no
 * credentials are read), not wrapped in the `{ data }` envelope because tools expect the bare
 * document, and cacheable: shared caches keep it for 5 minutes and revalidate with the ETag.
 * Readable from any web page so browser-based explorers and client generators can load it.
 */
export const GET = route({ auth: 'none', rateLimit: OPENAPI_RATE_LIMIT }, async (ctx) => {
  const { body, etag } = render(new URL(getEnv().APP_URL).origin);
  const headers = {
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    ETag: etag,
    'Access-Control-Allow-Origin': '*',
  };
  if (hasEtag(ctx.req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
});
