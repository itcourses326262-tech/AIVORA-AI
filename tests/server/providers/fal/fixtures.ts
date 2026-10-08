import { vi, type Mock } from 'vitest';
import sharp from 'sharp';
import { falModels } from '@/lib/catalog/models/fal';
import type { GenerationParams, ModelSpec } from '@/lib/catalog/types';
import { getEnv } from '@/server/env';
import type { ProviderContext, ProviderInput } from '@/server/providers/types';
import { fakeProviderContext } from '../../../helpers/fakes';

/** Shaped like a real fal key (`<id>:<secret>`) but worth nothing. */
export const FAKE_KEY = 'test-key-id:test-key-secret-0123456789abcdef';

export const QUEUE = 'https://queue.fal.run';

export function modelById(id: string): ModelSpec {
  const model = falModels.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`No fal model ${id}`);
  return model;
}

export async function pngImage(
  width = 64,
  height = 48,
  options: { alpha?: boolean } = {},
): Promise<Uint8Array> {
  const background = options.alpha
    ? { r: 200, g: 30, b: 30, alpha: 0.5 }
    : { r: 200, g: 30, b: 30, alpha: 1 };
  const buffer = await sharp({ create: { width, height, channels: 4, background } })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

/** What a request that names no parameters runs with (the validator's defaults). */
function defaultParams(model: ModelSpec): GenerationParams {
  const { limits } = model;
  return {
    aspectRatio: limits.defaultAspectRatio,
    count: limits.defaultCount,
    ...(limits.defaultDuration === undefined ? {} : { durationSec: limits.defaultDuration }),
    ...(limits.defaultResolution === undefined ? {} : { resolution: limits.defaultResolution }),
  };
}

export interface InputOptions {
  prompt?: string;
  negativePrompt?: string;
  params?: Partial<GenerationParams>;
  inputImage?: ProviderInput['inputImage'];
}

/** A request for `modelId` with that model's own defaults, like the validator would produce. */
export function inputFor(modelId: string, options: InputOptions = {}): ProviderInput {
  const model = modelById(modelId);
  return {
    generationId: 'gen_test',
    tool: model.tools[0] as ProviderInput['tool'],
    model,
    prompt: options.prompt ?? 'a red fox in the snow',
    ...(options.negativePrompt === undefined ? {} : { negativePrompt: options.negativePrompt }),
    params: { ...defaultParams(model), ...options.params },
    ...(options.inputImage === undefined ? {} : { inputImage: options.inputImage }),
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export interface FalHarness {
  ctx: ProviderContext;
  fetchMock: Mock<typeof fetch>;
  controller: AbortController;
  /** URL, method, headers and parsed JSON body of the n-th call. */
  call(index: number): { url: string; method: string; headers: Headers; body: unknown };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A context whose `fetch` is the given handler; nothing in these tests touches the network. */
export function falHarness(
  handler: Handler,
  env: Partial<ProviderContext['env']> = {},
): FalHarness {
  const controller = new AbortController();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) =>
    handler(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init ?? {},
    ),
  );
  const ctx = fakeProviderContext({
    signal: controller.signal,
    fetch: fetchMock,
    env: { ...getEnv(), FAL_KEY: FAKE_KEY, ...env },
  });
  return {
    ctx,
    fetchMock,
    controller,
    call(index) {
      const [url, init] = fetchMock.mock.calls[index] ?? [];
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      return {
        url: String(url),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body,
      };
    },
  };
}

/** The answer of `POST queue.fal.run/{endpoint}`, with fal's URL layout. */
export function submitAnswer(endpoint: string, requestId = 'req_123') {
  const [owner, app] = endpoint.split('/');
  const base = `${QUEUE}/${owner}/${app}/requests/${requestId}`;
  return {
    status: 'IN_QUEUE',
    request_id: requestId,
    response_url: base,
    status_url: `${base}/status`,
    cancel_url: `${base}/cancel`,
    queue_position: 0,
  };
}

export const META = {
  v: 1,
  requestId: 'req_123',
  statusUrl: `${QUEUE}/fal-ai/flux/requests/req_123/status`,
  responseUrl: `${QUEUE}/fal-ai/flux/requests/req_123`,
  cancelUrl: `${QUEUE}/fal-ai/flux/requests/req_123/cancel`,
} as const;
