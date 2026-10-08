import { vi } from 'vitest';
import type { AssetDTO, GenerationDTO, ModelDTO, UserDTO } from '@/lib/api-types';
import { getModel } from '@/lib/catalog';
import type { ModelSpec } from '@/lib/catalog/types';
import { newId } from '@/lib/id';

// ---- Fixtures -----------------------------------------------------------------------------------

export function assetDTO(overrides: Partial<AssetDTO> = {}): AssetDTO {
  const id = overrides.id ?? newId('ast');
  return {
    id,
    kind: 'image',
    mimeType: 'image/webp',
    width: 1024,
    height: 1024,
    bytes: 20_000,
    url: `/api/v1/media/${id}`,
    thumbUrl: `/api/v1/media/${id}?variant=thumb`,
    ...overrides,
  };
}

export function generationDTO(overrides: Partial<GenerationDTO> = {}): GenerationDTO {
  const outputs = overrides.outputs ?? [assetDTO()];
  return {
    id: newId('gen'),
    tool: 'text-to-image',
    kind: 'image',
    modelId: 'aivore-demo-image',
    prompt: 'A lone lighthouse at sunset',
    params: { aspectRatio: '1:1', count: 1 },
    status: 'succeeded',
    progress: 100,
    cost: 1,
    outputs,
    isPublic: false,
    isFavorite: false,
    createdAt: Date.now() - 5_000,
    ...overrides,
  };
}

/** A model as `GET /models` returns it: the catalog entry without its upstream id. */
export function modelDTO(id: string, overrides: Partial<ModelDTO> = {}): ModelDTO {
  const spec = getModel(id) as ModelSpec;
  const { providerModel: _providerModel, ...rest } = spec;
  return { ...rest, available: true, ...overrides };
}

export const DEMO_IMAGE = () => modelDTO('aivore-demo-image');
export const DEMO_VIDEO = () => modelDTO('aivore-demo-video');
/** A real image model whose provider has no key on this server. */
export const FLUX_UNAVAILABLE = () =>
  modelDTO('fal-flux-schnell', { available: false, unavailableReason: 'not_configured' });

/** An image-to-image model that keeps the proportions of the input picture. */
export const EDIT_MODEL = (): ModelDTO => ({
  ...DEMO_IMAGE(),
  id: 'edit-keeps-shape',
  label: 'Shape-keeping Edit',
  badges: ['quality'],
  tools: ['image-to-image'],
  limits: { ...DEMO_IMAGE().limits, followsInputAspect: true },
});

export const USER: Pick<UserDTO, 'id' | 'email' | 'name' | 'role' | 'locale' | 'creditBalance'> = {
  id: 'usr_01hzzzzzzzzzzzzzzzzzzzzzzz',
  email: 'layla@example.com',
  name: 'Layla Hassan',
  role: 'user',
  locale: 'en',
  creditBalance: 50,
};

// ---- A fake API ---------------------------------------------------------------------------------

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function apiError(
  status: number,
  code: string,
  details?: unknown,
  headers: Record<string, string> = {},
): Response {
  return json({ error: { code, message: 'English message for developers', details } }, status, headers);
}

export interface Call {
  method: string;
  /** Path and query below `/api/v1`, e.g. `/generations?limit=24`. */
  path: string;
  headers: Headers;
  body: unknown;
}

export interface FakeApi {
  calls: Call[];
  /** The balance `GET /auth/me` reports and `POST /generations` spends from. */
  balance: number;
  /** Everything the user has, newest first; mutate it, then let polling pick it up. */
  generations: GenerationDTO[];
  models: ModelDTO[];
  /** Replaces the answer of the first matching route (return nothing to fall through). */
  intercept: (handler: (call: Call) => Response | Promise<Response> | undefined) => void;
  /** Calls whose path starts with `prefix` (after the method), e.g. `callsTo('POST', '/generations')`. */
  callsTo: (method: string, prefix: string) => Call[];
}

export interface FakeApiOptions {
  models?: ModelDTO[];
  generations?: GenerationDTO[];
  balance?: number;
  /** `nextCursor` of the first history page. */
  nextCursor?: string | null;
  enhance?: (prompt: string) => { prompt: string; translated: boolean };
}

/**
 * Stubs `fetch` with an in-memory copy of the endpoints the studio uses. `POST /generations`
 * creates a queued generation and spends its cost, `cancel` refunds, `PATCH` and `DELETE` edit the
 * list, `?ids=` answers from it: so a test drives the screen by changing `api.generations`.
 */
export function installFakeApi(options: FakeApiOptions = {}): FakeApi {
  const interceptors: Array<(call: Call) => Response | Promise<Response> | undefined> = [];
  const api: FakeApi = {
    calls: [],
    balance: options.balance ?? 50,
    generations: [...(options.generations ?? [])],
    models: options.models ?? [DEMO_IMAGE(), DEMO_VIDEO(), FLUX_UNAVAILABLE()],
    intercept: (handler) => interceptors.push(handler),
    callsTo: (method, prefix) =>
      api.calls.filter((call) => call.method === method && call.path.startsWith(prefix)),
  };

  async function route(call: Call): Promise<Response> {
    const url = new URL(call.path, 'http://localhost');
    const path = url.pathname;
    const id = /^\/generations\/(gen_[a-z0-9]+)/.exec(path)?.[1];

    if (call.method === 'GET' && path === '/models') return json({ data: api.models });
    if (call.method === 'GET' && path === '/auth/me') {
      return json({ data: { ...USER, creditBalance: api.balance, createdAt: 0 } });
    }
    if (call.method === 'GET' && path === '/generations') {
      const ids = url.searchParams.get('ids');
      if (ids) {
        const wanted = new Set(ids.split(','));
        return json({ data: api.generations.filter((g) => wanted.has(g.id)), nextCursor: null });
      }
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const cursor = url.searchParams.get('cursor');
      const start = cursor ? Number(cursor) : 0;
      const slice = api.generations.slice(start, start + limit);
      const more = start + limit < api.generations.length;
      return json({
        data: slice,
        nextCursor: more ? String(start + limit) : (options.nextCursor ?? null),
      });
    }
    if (call.method === 'POST' && path === '/generations') {
      const body = call.body as {
        tool: GenerationDTO['tool'];
        modelId: string;
        prompt: string;
        negativePrompt?: string;
        params?: Partial<GenerationDTO['params']>;
        inputAssetId?: string;
        isPublic?: boolean;
      };
      const model = api.models.find((candidate) => candidate.id === body.modelId);
      const created = generationDTO({
        tool: body.tool,
        kind: model?.kind ?? 'image',
        modelId: body.modelId,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt,
        params: {
          aspectRatio: model?.limits.defaultAspectRatio ?? '1:1',
          count: 1,
          ...body.params,
        },
        status: 'queued',
        progress: 0,
        outputs: [],
        isPublic: body.isPublic ?? false,
        input: body.inputAssetId ? assetDTO({ id: body.inputAssetId }) : undefined,
        createdAt: Date.now(),
      });
      api.generations.unshift(created);
      api.balance -= created.cost;
      return json({ data: created }, 201);
    }
    if (id && call.method === 'POST' && path.endsWith('/cancel')) {
      const found = api.generations.find((g) => g.id === id);
      if (!found) return apiError(404, 'not_found');
      found.status = 'canceled';
      api.balance += found.cost;
      return json({ data: found });
    }
    if (id && call.method === 'PATCH') {
      const found = api.generations.find((g) => g.id === id);
      if (!found) return apiError(404, 'not_found');
      Object.assign(found, call.body);
      return json({ data: found });
    }
    if (id && call.method === 'DELETE') {
      api.generations = api.generations.filter((g) => g.id !== id);
      return new Response(null, { status: 204 });
    }
    if (call.method === 'POST' && path === '/prompt/enhance') {
      const { prompt } = call.body as { prompt: string };
      const result = options.enhance?.(prompt) ?? {
        prompt: `${prompt}, highly detailed, cinematic lighting`,
        translated: false,
      };
      return json({ data: { ...result, engine: 'heuristic' } });
    }
    return apiError(404, 'not_found');
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = raw.replace(/^.*\/api\/v1/, '');
      const text = typeof init.body === 'string' ? init.body : undefined;
      const call: Call = {
        method: (init.method ?? 'GET').toUpperCase(),
        path,
        headers: new Headers(init.headers),
        body: text ? (JSON.parse(text) as unknown) : undefined,
      };
      api.calls.push(call);
      for (const handler of interceptors) {
        const response = await handler(call);
        if (response) return response;
      }
      return route(call);
    }),
  );
  return api;
}

// ---- A fake XMLHttpRequest for uploads ------------------------------------------------------------

export interface FakeUpload {
  /** Sends a progress event to the page. */
  progress: (loaded: number, total: number) => void;
  /** Answers with a status and a JSON body. */
  respond: (status: number, body: unknown) => void;
  /** The connection fails without an answer. */
  fail: () => void;
  aborted: boolean;
  file: File | Blob | null;
  url: string;
}

/** Replaces `XMLHttpRequest`; each `send()` is collected so a test can answer it when it likes. */
export function installFakeUploads(): FakeUpload[] {
  const uploads: FakeUpload[] = [];

  class FakeXhr {
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    status = 0;
    responseText = '';
    private url = '';
    private entry: FakeUpload | null = null;
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    getResponseHeader() {
      return null;
    }
    abort() {
      if (this.entry) this.entry.aborted = true;
    }
    send(form: FormData) {
      const entry: FakeUpload = {
        aborted: false,
        url: this.url,
        file: form.get('file') as File | null,
        progress: (loaded, total) =>
          this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent),
        respond: (status, body) => {
          this.status = status;
          this.responseText = JSON.stringify(body);
          this.onload?.();
        },
        fail: () => this.onerror?.(),
      };
      this.entry = entry;
      uploads.push(entry);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return uploads;
}

/** A tiny picture of the given type, as a `File`. */
export function imageFile(name = 'photo.png', type = 'image/png', size = 2048): File {
  return new File([new Uint8Array(size)], name, { type });
}
