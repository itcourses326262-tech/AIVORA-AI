import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type {
  ApiKeyDTO,
  CreateApiKeyResponse,
  CreateGenerationRequest,
  GenerationDTO,
  GenerationStatus,
  LedgerEntryDTO,
  ListGenerationsQuery,
  Page,
  UserDTO,
} from '@/lib/api-types';

const API = '/api/v1';

export const DEMO_IMAGE_MODEL = 'aivore-demo-image';
export const DEMO_VIDEO_MODEL = 'aivore-demo-video';

/** How long the Demo provider may take: images 2.5-4 s, videos 7-10 s, plus queueing under load. */
export const IMAGE_TIMEOUT_MS = 45_000;
export const VIDEO_TIMEOUT_MS = 75_000;

/** Prompt words the Demo provider understands (see `providers/mock/index.ts`). */
export const DEMO_WORDS = {
  /** The job completes inside the submit call: no waiting for the Demo latency. */
  sync: '__sync__',
  /** The job fails with an `unavailable` error after its delay. */
  fail: '__fail__',
  /** The job takes 25 s, long enough to cancel it while it runs. */
  slow: '__slow__',
} as const;

export interface ApiError {
  status: number;
  code: string | undefined;
  body: unknown;
}

/** Everything a test does through the HTTP API, with the CSRF `Origin` header the server expects. */
export class ApiClient {
  constructor(
    readonly request: APIRequestContext,
    readonly origin: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { origin: this.origin, ...extra };
  }

  /** The status of any call, for tests about what is refused (404, 401, ...). */
  async statusOf(
    method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<number> {
    const response = await this.request.fetch(path, {
      method,
      headers: this.headers(),
      ...(data === undefined ? {} : { data }),
    });
    return response.status();
  }

  /** The bytes of a media URL, as this client may see it. */
  async bytes(path: string): Promise<Buffer> {
    const response = await this.request.get(path);
    expect(response.status(), `GET ${path}`).toBe(200);
    return Buffer.from(await response.body());
  }

  private async data<T>(response: APIResponse): Promise<T> {
    const text = await response.text();
    if (!response.ok()) throw new Error(`${response.url()} answered ${response.status()}: ${text}`);
    return (JSON.parse(text) as { data: T }).data;
  }

  async register(input: {
    name: string;
    email: string;
    password: string;
    locale?: 'ar' | 'en';
  }): Promise<UserDTO> {
    const response = await this.request.post(`${API}/auth/register`, {
      data: { locale: 'en', ...input },
      headers: this.headers(),
    });
    return this.data<UserDTO>(response);
  }

  async login(email: string, password: string): Promise<APIResponse> {
    return this.request.post(`${API}/auth/login`, {
      data: { email, password },
      headers: this.headers(),
    });
  }

  async me(): Promise<UserDTO | null> {
    return this.data<UserDTO | null>(await this.request.get(`${API}/auth/me`));
  }

  async balance(): Promise<number> {
    const user = await this.me();
    if (!user) throw new Error('not signed in');
    return user.creditBalance;
  }

  /** Every ledger entry, newest first. */
  async ledger(): Promise<LedgerEntryDTO[]> {
    const entries: LedgerEntryDTO[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor
        ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
        : '?limit=100';
      const response = await this.request.get(`${API}/account/ledger${query}`);
      expect(response.ok()).toBe(true);
      const page = (await response.json()) as Page<LedgerEntryDTO>;
      entries.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return entries;
  }

  async createGeneration(body: CreateGenerationRequest): Promise<GenerationDTO> {
    const response = await this.request.post(`${API}/generations`, {
      data: body,
      headers: this.headers({ 'idempotency-key': crypto.randomUUID() }),
    });
    return this.data<GenerationDTO>(response);
  }

  /** A raw create call, for the refusals (402, 422, ...) a test wants to look at. */
  async tryCreateGeneration(body: CreateGenerationRequest): Promise<ApiError | GenerationDTO> {
    const response = await this.request.post(`${API}/generations`, {
      data: body,
      headers: this.headers({ 'idempotency-key': crypto.randomUUID() }),
    });
    if (response.ok()) return ((await response.json()) as { data: GenerationDTO }).data;
    const body_ = (await response.json()) as { error?: { code?: string } };
    return { status: response.status(), code: body_.error?.code, body: body_ };
  }

  async getGeneration(id: string): Promise<GenerationDTO> {
    return this.data<GenerationDTO>(await this.request.get(`${API}/generations/${id}`));
  }

  async listGenerations(query: Partial<ListGenerationsQuery> = {}): Promise<GenerationDTO[]> {
    const params = new URLSearchParams({ limit: '100' });
    for (const [key, value] of Object.entries(query)) params.set(key, String(value));
    const response = await this.request.get(`${API}/generations?${params.toString()}`);
    expect(response.ok()).toBe(true);
    return ((await response.json()) as Page<GenerationDTO>).data;
  }

  async patchGeneration(
    id: string,
    patch: { isPublic?: boolean; isFavorite?: boolean },
  ): Promise<GenerationDTO> {
    const response = await this.request.patch(`${API}/generations/${id}`, {
      data: patch,
      headers: this.headers(),
    });
    return this.data<GenerationDTO>(response);
  }

  /** Polls until the generation reaches `status`, with web-first retries instead of sleeping. */
  async waitForStatus(
    id: string,
    status: GenerationStatus,
    timeoutMs = IMAGE_TIMEOUT_MS,
  ): Promise<GenerationDTO> {
    await expect
      .poll(async () => (await this.getGeneration(id)).status, {
        message: `generation ${id} should become ${status}`,
        timeout: timeoutMs,
        intervals: [250, 500, 1000, 1000, 2000],
      })
      .toBe(status);
    return this.getGeneration(id);
  }

  /** Uploads a picture as an input asset (`role: input`) and returns its id. */
  async uploadImage(bytes: Buffer, mimeType: string, name: string): Promise<string> {
    const response = await this.request.post(`${API}/uploads`, {
      multipart: { file: { name, mimeType, buffer: bytes } },
      headers: this.headers(),
    });
    return (await this.data<{ id: string }>(response)).id;
  }

  async createKey(name: string): Promise<CreateApiKeyResponse> {
    const response = await this.request.post(`${API}/keys`, {
      data: { name },
      headers: this.headers(),
    });
    return this.data<CreateApiKeyResponse>(response);
  }

  async listKeys(): Promise<ApiKeyDTO[]> {
    return ((await (await this.request.get(`${API}/keys`)).json()) as Page<ApiKeyDTO>).data;
  }
}

/** A finished Demo image generation, created through the API (`count` pictures). */
export async function createDemoImage(
  api: ApiClient,
  prompt: string,
  options: { count?: number; fast?: boolean } = {},
): Promise<GenerationDTO> {
  const created = await api.createGeneration({
    tool: 'text-to-image',
    modelId: DEMO_IMAGE_MODEL,
    prompt: options.fast === false ? prompt : `${prompt} ${DEMO_WORDS.sync}`,
    params: { count: options.count ?? 1 },
  });
  return api.waitForStatus(created.id, 'succeeded');
}

/** A finished Demo video generation (a looping GIF "motion preview"), created through the API. */
export async function createDemoVideo(
  api: ApiClient,
  prompt: string,
  options: { durationSec?: number; resolution?: '480p' | '720p' } = {},
): Promise<GenerationDTO> {
  const created = await api.createGeneration({
    tool: 'text-to-video',
    modelId: DEMO_VIDEO_MODEL,
    prompt: `${prompt} ${DEMO_WORDS.sync}`,
    params: { durationSec: options.durationSec ?? 3, resolution: options.resolution ?? '480p' },
  });
  return api.waitForStatus(created.id, 'succeeded', VIDEO_TIMEOUT_MS);
}

/** What `seedGallery` created: a mix of kinds and outcomes with recognisable prompts. */
export interface SeededGallery {
  alpine: GenerationDTO;
  neon: GenerationDTO;
  waves: GenerationDTO;
  broken: GenerationDTO;
}

/** An account's gallery with one single image, a pair of images, a video clip and a failed run. */
export async function seedGallery(api: ApiClient): Promise<SeededGallery> {
  const request = (prompt: string): CreateGenerationRequest => ({
    tool: 'text-to-image',
    modelId: DEMO_IMAGE_MODEL,
    prompt: `${prompt} ${DEMO_WORDS.sync}`,
  });
  // One after the other: the gallery lists newest first, so the order of creation is the order on screen
  // (alpine is last, broken first) and tests can name a creation's neighbours.
  const created = [
    await api.createGeneration(request('Alpine lake at sunrise')),
    await api.createGeneration({ ...request('Neon city in the rain'), params: { count: 2 } }),
    await api.createGeneration({
      tool: 'text-to-video',
      modelId: DEMO_VIDEO_MODEL,
      prompt: `Ocean waves at dusk ${DEMO_WORDS.sync}`,
      params: { durationSec: 3, resolution: '480p' },
    }),
    await api.createGeneration(request(`Broken tower ${DEMO_WORDS.fail}`)),
  ] as const;
  const [alpine, neon, waves, broken] = await Promise.all([
    api.waitForStatus(created[0].id, 'succeeded'),
    api.waitForStatus(created[1].id, 'succeeded'),
    api.waitForStatus(created[2].id, 'succeeded', VIDEO_TIMEOUT_MS),
    api.waitForStatus(created[3].id, 'failed'),
  ]);
  return { alpine, neon, waves, broken };
}
