import { getEnv } from '@/server/env';

type RouteHandlerLike<P> = (req: Request, nextCtx?: { params: Promise<P> }) => Promise<Response>;

export interface InvokeOptions<P> {
  /** Defaults to `POST` when a body is given, otherwise `GET`. */
  method?: string;
  /** A path such as `/api/v1/models` (resolved against `APP_URL`) or an absolute URL. Default `/`. */
  url?: string;
  /** Appended to `url`; `undefined` values are skipped and arrays repeat the key. */
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  headers?: Record<string, string>;
  /**
   * Plain values (objects, arrays, numbers, booleans, null) are sent as JSON with the right
   * content type. A `string`, `Uint8Array` or `FormData` is sent as is, so malformed JSON and
   * multipart uploads can be tested; set `content-type` yourself for those.
   */
  body?: unknown;
  /** Dynamic route segments, delivered the way Next.js does: as a promise. */
  params?: P;
}

export interface InvokeResult<T = unknown> {
  status: number;
  headers: Headers;
  /** The parsed JSON body, or `undefined` when the response has none (204) or is not JSON. */
  json: T;
  text: string;
  response: Response;
}

function buildUrl(url: string, query: InvokeOptions<unknown>['query']): URL {
  const result = new URL(url, getEnv().APP_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      result.searchParams.append(key, String(item));
    }
  }
  return result;
}

function buildInit(options: InvokeOptions<unknown>): RequestInit {
  const headers = new Headers(options.headers);
  const { body } = options;
  const init: RequestInit = {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
  };
  if (body === undefined) return init;
  if (typeof body === 'string' || body instanceof FormData) return { ...init, body };
  if (body instanceof Uint8Array) return { ...init, body: new Uint8Array(body) };
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return { ...init, body: JSON.stringify(body) };
}

/**
 * Calls a route handler (`export const GET = route(...)`) with a real `Request`, the way Next.js
 * does, and returns the status, headers and parsed JSON of its `Response`. Nothing is mocked: pair
 * it with `createSession(...).headers` for authenticated calls.
 */
export async function invokeRoute<T = unknown, P = Record<string, never>>(
  handler: RouteHandlerLike<P>,
  options: InvokeOptions<P> = {},
): Promise<InvokeResult<T>> {
  const request = new Request(buildUrl(options.url ?? '/', options.query), buildInit(options));
  const response = await handler(
    request,
    options.params === undefined ? undefined : { params: Promise.resolve(options.params) },
  );
  const text = await response.text();
  const isJson = /json/i.test(response.headers.get('content-type') ?? '') && text !== '';
  return {
    status: response.status,
    headers: response.headers,
    json: (isJson ? JSON.parse(text) : undefined) as T,
    text,
    response,
  };
}
