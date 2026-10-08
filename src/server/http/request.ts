import 'server-only';
import { z, type ZodType } from 'zod';
import { AppError, isAppError } from '@/lib/errors';
import { validationError } from './errors';

/** Name of the session cookie (owned by `server/auth`, mirrored here to detect credentials). */
export const SESSION_COOKIE_NAME = 'aivore_session';

export const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/** Whether the request carries anything `authenticate` could act on, so anonymous calls skip it. */
export function hasCredentials(req: Request): boolean {
  if (req.headers.has('authorization')) return true;
  const cookie = req.headers.get('cookie');
  if (!cookie) return false;
  return cookie.split(';').some((pair) => pair.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a sane inbound `X-Request-Id` (for tracing across proxies), otherwise makes one. */
export function requestIdOf(req: Request): string {
  const inbound = req.headers.get('x-request-id');
  return inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : crypto.randomUUID();
}

export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

const JSON_CONTENT_TYPE = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i;
const FORM_CONTENT_TYPE = /^multipart\/form-data\s*(?:;|$)/i;

function bodyTooLarge(maxBytes: number): AppError {
  return AppError.of('payload_too_large', `Request body exceeds ${maxBytes} bytes`);
}

/** 413 when the client announces a body above the cap, before a single byte is read. */
function assertDeclaredLength(req: Request, maxBytes: number): void {
  const header = req.headers.get('content-length');
  if (header === null) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > maxBytes) throw bodyTooLarge(maxBytes);
}

/**
 * Returns a request whose body fails with `payload_too_large` as soon as more than `maxBytes`
 * have been read, whichever way a handler consumes it (`json()`, `text()`, `formData()`,
 * `arrayBuffer()` or the raw stream). Chunked uploads have no Content-Length to check up front,
 * so the cap has to sit on the stream itself. Bodiless requests are returned as they are.
 */
export function capRequestBody(req: Request, maxBytes: number): Request {
  assertDeclaredLength(req, maxBytes);
  if (req.body === null) return req;
  let received = 0;
  const limited = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) controller.error(bodyTooLarge(maxBytes));
        else controller.enqueue(chunk);
      },
    }),
  );
  const init: RequestInit & { duplex: 'half' } = {
    method: req.method,
    headers: req.headers,
    body: limited,
    duplex: 'half',
    signal: req.signal,
  };
  return new Request(req.url, init);
}

async function readLimited(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw bodyTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads the JSON body with a hard size cap. An absent or empty body yields `undefined` so schemas
 * decide whether that is acceptable. Non-JSON content is 415, oversized 413, malformed 400.
 */
export async function readJsonBody(
  req: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown> {
  if (req.body === null) return undefined;
  if (!JSON_CONTENT_TYPE.test(req.headers.get('content-type') ?? '')) {
    throw AppError.of('unsupported_media_type', 'Content-Type must be application/json');
  }
  assertDeclaredLength(req, maxBytes);

  const bytes = await readLimited(req.body, maxBytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw AppError.of('bad_request', 'Request body is not valid UTF-8');
  }
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw AppError.of('bad_request', 'Request body is not valid JSON');
  }
}

/**
 * Parses a `multipart/form-data` body. Size is whatever cap `req` carries (see
 * {@link capRequestBody}; `route()` applies it to `ctx.req`), a wrong content type is 415 and an
 * unparseable body is 400.
 */
export async function readFormBody(req: Request): Promise<FormData> {
  if (!FORM_CONTENT_TYPE.test(req.headers.get('content-type') ?? '')) {
    throw AppError.of('unsupported_media_type', 'Content-Type must be multipart/form-data');
  }
  try {
    return await req.formData();
  } catch (error) {
    if (isAppError(error)) throw error;
    throw AppError.of('bad_request', 'Request body is not valid multipart/form-data');
  }
}

/**
 * Query string as a plain object; a key that appears more than once becomes an array. The object
 * has no prototype and `__proto__` is dropped, so a hostile `?__proto__=x` or `?length=1` can
 * neither swap the prototype nor be mistaken for an inherited member.
 */
export function queryObject(req: Request): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of new URL(req.url).searchParams) {
    if (key === '__proto__') continue;
    const previous = Object.hasOwn(out, key) ? out[key] : undefined;
    if (previous === undefined) out[key] = value;
    else out[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return out;
}

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

/** `?limit=&cursor=` for list endpoints: limit 1-100 (default 20), opaque cursor. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
