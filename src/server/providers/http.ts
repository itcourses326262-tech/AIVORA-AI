// OWNER: providers-mock — real (shared by every adapter). Extend additively only.
import 'server-only';
import type { ZodType } from 'zod';
import { isRecord, safeJson } from '@/lib/utils';
import { ProviderError, providerErrorFromStatus } from './errors';
import type { ProviderContext } from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
/** Error payloads are only read to explain a failure, so a small prefix is enough. */
const ERROR_BODY_LIMIT_BYTES = 64 * 1024;
const MAX_DETAIL_CHARS = 200;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A non-2xx response, handed to {@link HttpJsonRequest.classifyError}. */
export interface HttpFailure {
  status: number;
  headers: Headers;
  /** The payload parsed as JSON, or undefined when it is not JSON. */
  body: unknown;
  /** The payload as text (cut at 64 KiB). */
  text: string;
}

export interface HttpJsonRequest<T> {
  url: string;
  /** Defaults to GET, or POST when there is a body. */
  method?: HttpMethod;
  headers?: Readonly<Record<string, string>>;
  /** Serialized as JSON; `content-type: application/json` is added when missing. */
  body?: unknown;
  /** Defaults to 30 s. Expiry is a retryable `timeout` {@link ProviderError}. */
  timeoutMs?: number;
  /** Defaults to 10 MiB. A larger success payload is an `unknown` {@link ProviderError}. */
  maxResponseBytes?: number;
  /** Validates the success payload; a mismatch is an `unknown` {@link ProviderError}. */
  schema?: ZodType<T>;
  /**
   * Provider-specific mapping for error payloads (for example a content-safety error shape).
   * Return undefined to fall back to the generic status mapping.
   */
  classifyError?: (failure: HttpFailure) => ProviderError | undefined;
}

export interface HttpJsonResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

const CONTENT_POLICY_PATTERN =
  /content[_\s-]?policy|safety[_\s-]?system|moderation[_\s-]?blocked|violates?\s+(?:our|the)\s+(?:content|usage|safety)/i;

/** `Retry-After` as milliseconds: delta-seconds or an HTTP date. Undefined when absent or invalid. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const ms = seconds !== undefined ? seconds * 1000 : Date.parse(trimmed) - now;
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(0, Math.round(ms)), MAX_RETRY_AFTER_MS);
}

/** Reads at most `maxBytes` of the body; `truncated` tells whether more was available. */
async function readText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      const room = maxBytes - total;
      if (room > 0) chunks.push(value.subarray(0, room));
      total = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

/** The upstream's own explanation of a failure, shortened. Never includes the raw payload. */
function describeFailure(body: unknown): string | undefined {
  const candidates: unknown[] = [];
  if (typeof body === 'string') candidates.push(body);
  if (isRecord(body)) {
    const { error, message, detail } = body;
    candidates.push(error, message, detail);
    if (isRecord(error)) candidates.push(error.message);
  }
  const found = candidates.find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  if (found === undefined) return undefined;
  return found.length > MAX_DETAIL_CHARS ? `${found.slice(0, MAX_DETAIL_CHARS)}...` : found;
}

/** Aborts propagate untouched; everything else becomes a retryable ProviderError. */
function transportFailure(
  error: unknown,
  ctx: Pick<ProviderContext, 'signal'>,
  timeout: AbortSignal,
  timeoutMs: number,
  host: string,
): unknown {
  if (error instanceof ProviderError || ctx.signal.aborted) return error;
  if (timeout.aborted) {
    return new ProviderError('timeout', `Request to ${host} timed out after ${timeoutMs} ms`, {
      cause: error,
    });
  }
  return new ProviderError('unavailable', `Network error calling ${host}`, { cause: error });
}

/**
 * The one HTTP client every provider adapter uses for JSON APIs. It sends the request through
 * `ctx.fetch` under `ctx.signal` plus a timeout, parses the JSON answer and reports every failure
 * as a {@link ProviderError} (HTTP statuses per section 6.4, see `providerErrorFromStatus`).
 *
 * Cancellation is not an error of the provider: if `ctx.signal` aborts, the abort error is rethrown
 * untouched. Request and response bodies are never logged; only method, host, path, status and time.
 */
export async function httpJson<T = unknown>(
  ctx: Pick<ProviderContext, 'fetch' | 'signal' | 'log'>,
  request: HttpJsonRequest<T>,
): Promise<HttpJsonResponse<T>> {
  const url = new URL(request.url);
  const method = request.method ?? (request.body === undefined ? 'GET' : 'POST');
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeout = AbortSignal.timeout(timeoutMs);

  const headers = new Headers(request.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  let body: string | undefined;
  if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  const startedAt = performance.now();
  const logFields = { method, host: url.host, path: url.pathname };
  let response: Response;
  let text: string;
  let truncated: boolean;
  try {
    response = await ctx.fetch(request.url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.any([ctx.signal, timeout]),
    });
    ({ text, truncated } = await readText(
      response,
      response.ok ? maxResponseBytes : ERROR_BODY_LIMIT_BYTES,
    ));
  } catch (error) {
    throw transportFailure(error, ctx, timeout, timeoutMs, url.host);
  }
  ctx.log.debug('Provider request finished', {
    ...logFields,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
  });

  if (!response.ok) {
    const parsed = safeJson(text);
    const custom = request.classifyError?.({
      status: response.status,
      headers: response.headers,
      body: parsed,
      text,
    });
    throw (
      custom ??
      providerErrorFromStatus(response.status, {
        message: describeFailure(parsed),
        contentPolicy: CONTENT_POLICY_PATTERN.test(text),
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      })
    );
  }

  if (truncated) {
    throw new ProviderError(
      'unknown',
      `Response from ${url.host} is larger than ${maxResponseBytes} bytes`,
      { httpStatus: response.status },
    );
  }
  const json = text.trim() === '' ? undefined : safeJson(text);
  if (json === undefined && text.trim() !== '') {
    throw new ProviderError('unknown', `Response from ${url.host} is not valid JSON`, {
      httpStatus: response.status,
    });
  }
  if (!request.schema)
    return { status: response.status, headers: response.headers, data: json as T };

  const checked = request.schema.safeParse(json);
  if (!checked.success) {
    const where = checked.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
    throw new ProviderError('unknown', `Unexpected response shape from ${url.host} at: ${where}`, {
      httpStatus: response.status,
    });
  }
  return { status: response.status, headers: response.headers, data: checked.data };
}
