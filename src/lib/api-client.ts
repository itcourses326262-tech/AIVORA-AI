/**
 * Typed `fetch` wrapper for the v1 API. It unwraps the `{ data }` envelope, turns every failure into
 * an {@link ApiError} carrying a stable `code` (map it to text with `errors.<code>`), and never
 * writes to the console. Response bodies are trusted to match `T`; they are not validated.
 */
import type { ApiErrorBody, Page } from '@/lib/api-types';
import { codeForStatus, isErrorCode, type AnyErrorCode } from '@/lib/errors';
import { isRecord, safeJson } from '@/lib/utils';

export class ApiError extends Error {
  override readonly name: string = 'ApiError';

  constructor(
    readonly code: AnyErrorCode,
    /** HTTP status, or 0 when no response was received. */
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export interface RequestOptions {
  /** Appended to the URL. `undefined`/`null` are skipped; arrays are comma-joined (`ids=a,b`). */
  query?: Readonly<Record<string, QueryValue>>;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface UploadOptions extends RequestOptions {
  /** Multipart field name. Defaults to `file`. */
  fieldName?: string;
  /** File name sent with a bare `Blob`; a `File` keeps its own. */
  filename?: string;
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  /** For list endpoints: resolves to `{ data, nextCursor }` instead of unwrapping. */
  page<T>(path: string, options?: RequestOptions): Promise<Page<T>>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = void>(path: string, options?: RequestOptions): Promise<T>;
  /** Multipart upload of one file. */
  upload<T>(path: string, file: Blob, options?: UploadOptions): Promise<T>;
}

export interface ApiClientConfig {
  /** Defaults to `/api/v1`. */
  baseUrl?: string;
  /** Defaults to the global `fetch`, looked up per call. */
  fetch?: typeof fetch;
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const search = params.toString();
  const separator = path.startsWith('/') ? '' : '/';
  // A path may already carry its own query string (`/models?kind=image`).
  const joiner = path.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${path}${search ? `${joiner}${search}` : ''}`;
}

function parseErrorBody(status: number, body: unknown, requestId: string | undefined): ApiError {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    const { code, message, details } = body.error as ApiErrorBody['error'];
    return new ApiError(
      isErrorCode(code) ? code : codeForStatus(status),
      status,
      message,
      details,
      requestId,
    );
  }
  return new ApiError(
    codeForStatus(status),
    status,
    `Request failed with status ${status}`,
    undefined,
    requestId,
  );
}

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const baseUrl = (config.baseUrl ?? '/api/v1').replace(/\/+$/, '');

  async function send(
    method: string,
    path: string,
    options: RequestOptions | undefined,
    payload?: { body: BodyInit; contentType?: string },
  ): Promise<{ status: number; body: unknown; empty: boolean }> {
    const headers = new Headers({ Accept: 'application/json', ...options?.headers });
    if (payload?.contentType) headers.set('Content-Type', payload.contentType);

    let response: Response;
    try {
      response = await (config.fetch ?? globalThis.fetch)(buildUrl(baseUrl, path, options?.query), {
        method,
        headers,
        body: payload?.body,
        signal: options?.signal,
      });
    } catch (cause) {
      // Aborting is the caller's decision, not a failure to report.
      if (options?.signal?.aborted) throw cause;
      throw new ApiError('network_error', 0, 'Network request failed', undefined, undefined, {
        cause,
      });
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      // The connection can drop after the headers arrived, while the body is still streaming.
      if (options?.signal?.aborted) throw cause;
      throw new ApiError('network_error', 0, 'Network request failed', undefined, requestId, {
        cause,
      });
    }
    const body = text.length > 0 ? safeJson(text) : undefined;

    if (!response.ok) throw parseErrorBody(response.status, body, requestId);
    if (text.length > 0 && body === undefined) {
      throw new ApiError(
        'invalid_response',
        response.status,
        'The response body is not valid JSON',
        undefined,
        requestId,
      );
    }
    return { status: response.status, body, empty: text.length === 0 };
  }

  function unwrap(result: Awaited<ReturnType<typeof send>>): unknown {
    if (result.empty) return undefined;
    if (isRecord(result.body) && 'data' in result.body) return result.body.data;
    throw new ApiError(
      'invalid_response',
      result.status,
      'The response is missing its data envelope',
    );
  }

  function json(body: unknown): { body: BodyInit; contentType?: string } | undefined {
    return body === undefined
      ? undefined
      : { body: JSON.stringify(body), contentType: 'application/json' };
  }

  return {
    async get<T>(path: string, options?: RequestOptions) {
      return unwrap(await send('GET', path, options)) as T;
    },

    async page<T>(path: string, options?: RequestOptions) {
      const result = await send('GET', path, options);
      const { body } = result;
      if (
        !isRecord(body) ||
        !Array.isArray(body.data) ||
        !(typeof body.nextCursor === 'string' || body.nextCursor === null)
      ) {
        throw new ApiError(
          'invalid_response',
          result.status,
          'The response is not a page of results',
        );
      }
      return { data: body.data as T[], nextCursor: body.nextCursor };
    },

    async post<T>(path: string, body?: unknown, options?: RequestOptions) {
      return unwrap(await send('POST', path, options, json(body))) as T;
    },

    async patch<T>(path: string, body?: unknown, options?: RequestOptions) {
      return unwrap(await send('PATCH', path, options, json(body))) as T;
    },

    async delete<T = void>(path: string, options?: RequestOptions) {
      return unwrap(await send('DELETE', path, options)) as T;
    },

    async upload<T>(path: string, file: Blob, options?: UploadOptions) {
      const form = new FormData();
      const field = options?.fieldName ?? 'file';
      if (options?.filename !== undefined) form.append(field, file, options.filename);
      else form.append(field, file);
      // No Content-Type: fetch must add the multipart boundary itself.
      return unwrap(await send('POST', path, options, { body: form })) as T;
    },
  };
}

/** Shared browser client for same-origin `/api/v1` calls. */
export const api: ApiClient = createApiClient();
