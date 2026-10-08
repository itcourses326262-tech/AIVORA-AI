import { getEnv } from '@/server/env';
import { DELETE as deleteKey } from '@/app/api/v1/keys/[id]/route';
import { GET as getAccount, PATCH as patchAccount } from '@/app/api/v1/account/route';
import { GET as getLedger } from '@/app/api/v1/account/ledger/route';
import { POST as changePassword } from '@/app/api/v1/account/password/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as logoutAll } from '@/app/api/v1/auth/logout-all/route';
import { GET as getMe } from '@/app/api/v1/auth/me/route';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { GET as getExplore } from '@/app/api/v1/explore/route';
import { POST as cancelGeneration } from '@/app/api/v1/generations/[id]/cancel/route';
import {
  DELETE as deleteGeneration,
  GET as getGeneration,
  PATCH as patchGeneration,
} from '@/app/api/v1/generations/[id]/route';
import { GET as listGenerations, POST as createGeneration } from '@/app/api/v1/generations/route';
import { GET as getKeys, POST as createKey } from '@/app/api/v1/keys/route';
import { GET as getMedia, HEAD as headMedia } from '@/app/api/v1/media/[assetId]/route';
import { GET as getModels } from '@/app/api/v1/models/route';
import { POST as enhancePrompt } from '@/app/api/v1/prompt/enhance/route';
import { GET as getTools } from '@/app/api/v1/tools/route';
import { POST as upload } from '@/app/api/v1/uploads/route';
import { invokeRoute, type InvokeResult } from '../../helpers/http';

type Handler = (
  req: Request,
  nextCtx?: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** Every route's own `route<P>()` type differs in its params; the table erases that. */
const handler = (fn: unknown): Handler => fn as Handler;

// The real route handlers, exactly as Next.js mounts them under /api/v1. Nothing here is mocked.
const ROUTES: ReadonlyArray<
  readonly [pattern: string, methods: Readonly<Record<string, Handler>>]
> = [
  ['/auth/register', { POST: handler(register) }],
  ['/auth/login', { POST: handler(login) }],
  ['/auth/logout', { POST: handler(logout) }],
  ['/auth/logout-all', { POST: handler(logoutAll) }],
  ['/auth/me', { GET: handler(getMe) }],
  ['/account', { GET: handler(getAccount), PATCH: handler(patchAccount) }],
  ['/account/password', { POST: handler(changePassword) }],
  ['/account/ledger', { GET: handler(getLedger) }],
  ['/keys', { GET: handler(getKeys), POST: handler(createKey) }],
  ['/keys/:id', { DELETE: handler(deleteKey) }],
  ['/models', { GET: handler(getModels) }],
  ['/tools', { GET: handler(getTools) }],
  ['/prompt/enhance', { POST: handler(enhancePrompt) }],
  ['/uploads', { POST: handler(upload) }],
  ['/media/:assetId', { GET: handler(getMedia), HEAD: handler(headMedia) }],
  ['/generations', { GET: handler(listGenerations), POST: handler(createGeneration) }],
  [
    '/generations/:id',
    {
      GET: handler(getGeneration),
      PATCH: handler(patchGeneration),
      DELETE: handler(deleteGeneration),
    },
  ],
  ['/generations/:id/cancel', { POST: handler(cancelGeneration) }],
  ['/explore', { GET: handler(getExplore) }],
];

interface Resolved {
  handler: Handler;
  params: Record<string, string>;
  url: string;
}

const BASE = '/api/v1';

/** `path` is relative to `/api/v1`, or already absolute like the `url` of an `AssetDTO`. */
function resolve(method: string, path: string): Resolved {
  const url = path.startsWith(`${BASE}/`) ? path : `${BASE}${path}`;
  const segments = new URL(url, 'http://localhost').pathname.split('/').slice(3);
  for (const [pattern, methods] of ROUTES) {
    const wanted = pattern.split('/').slice(1);
    if (wanted.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = wanted.every((part, index) => {
      const segment = segments[index] ?? '';
      if (!part.startsWith(':')) return part === segment;
      params[part.slice(1)] = decodeURIComponent(segment);
      return true;
    });
    const found = methods[method];
    if (matches && found) return { handler: found, params, url };
  }
  throw new Error(`No route for ${method} ${path}`);
}

export interface Envelope<T> {
  data?: T;
  nextCursor?: string | null;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

export type Reply<T = unknown> = InvokeResult<Envelope<T>>;

/** A binary answer (media): the body is read as bytes, which `invokeRoute` would decode as text. */
export interface MediaReply {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

export interface Identity {
  /** `aivore_session=<token>` value. */
  token?: string;
  /** A raw `avk_…` key, sent as `Authorization: Bearer`. */
  apiKey?: string;
  /** Send `Origin: APP_URL`, as a browser does. Defaults to on, except for API-key callers. */
  origin?: boolean;
}

export interface CallOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  headers?: Record<string, string>;
}

/** A caller of the API: anonymous, a browser session or an API key. */
export class Client {
  constructor(readonly identity: Identity = {}) {}

  /** The same caller with some identity details changed (e.g. `{ origin: false }`). */
  as(patch: Identity): Client {
    return new Client({ ...this.identity, ...patch });
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const { token, apiKey, origin } = this.identity;
    return {
      ...(token === undefined ? {} : { cookie: `aivore_session=${token}` }),
      ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      ...((origin ?? apiKey === undefined) ? { origin: getEnv().APP_URL } : {}),
      ...extra,
    };
  }

  request<T = unknown>(method: string, path: string, init: CallOptions = {}): Promise<Reply<T>> {
    const target = resolve(method, path);
    return invokeRoute<Envelope<T>, Record<string, string>>(target.handler, {
      method,
      url: target.url,
      query: init.query,
      body: init.body,
      headers: this.headers(init.headers),
      params: target.params,
    });
  }

  get<T = unknown>(path: string, init?: CallOptions) {
    return this.request<T>('GET', path, init);
  }

  post<T = unknown>(path: string, body?: unknown, init: CallOptions = {}) {
    return this.request<T>('POST', path, { ...init, body });
  }

  patch<T = unknown>(path: string, body: unknown, init: CallOptions = {}) {
    return this.request<T>('PATCH', path, { ...init, body });
  }

  delete<T = unknown>(path: string, init?: CallOptions) {
    return this.request<T>('DELETE', path, init);
  }

  /** `GET`/`HEAD /media/:id[?…]` with the body as bytes. */
  async media(
    path: string,
    init: { method?: 'GET' | 'HEAD'; headers?: Record<string, string> } = {},
  ): Promise<MediaReply> {
    const method = init.method ?? 'GET';
    const target = resolve(method, path);
    const response = await target.handler(
      new Request(new URL(target.url, getEnv().APP_URL), {
        method,
        headers: this.headers(init.headers),
      }),
      { params: Promise.resolve(target.params) },
    );
    return {
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  }

  /** `POST /uploads` with one multipart `file` field. */
  upload<T = unknown>(
    bytes: Uint8Array,
    options: { filename?: string; type?: string; headers?: Record<string, string> } = {},
  ): Promise<Reply<T>> {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(bytes)], options.filename ?? 'photo.png', {
        type: options.type ?? 'image/png',
      }),
    );
    return this.post<T>('/uploads', form, { headers: options.headers });
  }
}

/** The `data` of a reply after checking its status; the failure message shows the whole body. */
export function dataOf<T>(reply: Reply<T>, status = 200): T {
  if (reply.status !== status || reply.json?.data === undefined) {
    throw new Error(`Expected ${status} with data, got ${reply.status}: ${reply.text}`);
  }
  return reply.json.data;
}

/** The error code of a failed reply, after checking its status. */
export function errorOf(reply: Reply, status: number): string {
  if (reply.status !== status || reply.json?.error === undefined) {
    throw new Error(`Expected error ${status}, got ${reply.status}: ${reply.text}`);
  }
  return reply.json.error.code;
}
