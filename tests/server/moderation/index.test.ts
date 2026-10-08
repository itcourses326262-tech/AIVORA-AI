import type * as LoggerModule from '@/server/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/server/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  getLogger: () => ({ ...logs, child: () => ({ ...logs }) }),
}));

import { parseEnv, type Env } from '@/server/env';
import { moderatePrompt } from '@/server/moderation';
import { OPENAI_MODERATION_MODEL, OPENAI_MODERATION_URL } from '@/server/moderation/remote';
import { CATEGORY_REASONS } from '@/server/moderation/terms';

const API_KEY = 'sk-test-moderation-key-0000';

function envWith(overrides: Record<string, string> = {}): Env {
  return parseEnv({ NODE_ENV: 'test', ...overrides });
}

const remoteEnv = envWith({ MODERATION_PROVIDER: 'openai', OPENAI_API_KEY: API_KEY });

function moderationResponse(flagged: string[], status = 200): Response {
  const categories = Object.fromEntries(
    ['sexual', 'sexual/minors', 'hate', 'violence', 'violence/graphic', 'harassment'].map(
      (name) => [name, flagged.includes(name)],
    ),
  );
  return Response.json(
    {
      id: 'modr-1',
      model: OPENAI_MODERATION_MODEL,
      results: [{ flagged: flagged.length > 0, categories }],
    },
    { status },
  );
}

beforeEach(() => {
  for (const fn of Object.values(logs)) fn.mockReset();
});

describe('moderatePrompt: local rules', () => {
  const env = envWith();

  it('allows ordinary prompts', async () => {
    await expect(moderatePrompt('a red fox in the snow', { env })).resolves.toEqual({
      allowed: true,
    });
    await expect(moderatePrompt('  ', { env })).resolves.toEqual({ allowed: true });
    await expect(moderatePrompt('ثعلب أحمر في الثلج', { env })).resolves.toEqual({ allowed: true });
  });

  it('blocks with a category and a generic reason', async () => {
    const result = await moderatePrompt('free porn video', { env });
    expect(result).toEqual({
      allowed: false,
      category: 'sexual_explicit',
      reason: CATEGORY_REASONS.sexual_explicit,
    });
  });

  it('never echoes the prompt or the matched term in the result or the logs', async () => {
    const samples: Array<[string, string]> = [
      ['a very specific hentai request', 'hentai'],
      ['p.o.r.n for the zorpish crowd', 'porn'],
      ['kill all muslims tomorrow', 'muslims'],
      ['سكس مع حبيبتي', 'سكس'],
    ];
    for (const [prompt, term] of samples) {
      const result = await moderatePrompt(prompt, { env });
      expect(result.allowed).toBe(false);
      const visible = JSON.stringify([result, logs.info.mock.calls, logs.warn.mock.calls]);
      expect(visible).not.toContain(term);
      expect(visible).not.toContain(prompt);
    }
  });

  it('logs the category and source only', async () => {
    await moderatePrompt('naked child', { env });
    expect(logs.info).toHaveBeenCalledWith('Prompt blocked by moderation', {
      category: 'sexual_minors',
      source: 'local',
    });
  });

  it('applies MODERATION_BLOCKLIST on top of the built-in rules', async () => {
    const custom = envWith({ MODERATION_BLOCKLIST: 'Zorp, forbidden phrase,ممنوع' });
    expect(await moderatePrompt('a zorp appears', { env: custom })).toEqual({
      allowed: false,
      category: 'blocklist',
      reason: CATEGORY_REASONS.blocklist,
    });
    expect((await moderatePrompt('the Forbidden Phrase', { env: custom })).allowed).toBe(false);
    expect((await moderatePrompt('هذا ممنوع', { env: custom })).allowed).toBe(false);
    expect((await moderatePrompt('zorpington', { env: custom })).allowed).toBe(true);
    expect((await moderatePrompt('a zorp appears', { env })).allowed).toBe(true);
    expect((await moderatePrompt('porn', { env: custom })).category).toBe('sexual_explicit');
  });

  it('reads the environment lazily when no env is passed', async () => {
    const result = await moderatePrompt('naked woman');
    expect(result.allowed).toBe(false);
  });
});

describe('moderatePrompt: remote check', () => {
  it('sends the prompt to the OpenAI moderation endpoint with the key', async () => {
    const fetchMock = vi.fn(async () => moderationResponse([]));
    const result = await moderatePrompt('a red fox', { env: remoteEnv, fetch: fetchMock });
    expect(result).toEqual({ allowed: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(OPENAI_MODERATION_URL);
    expect(OPENAI_MODERATION_URL).toBe('https://api.openai.com/v1/moderations');
    expect(call[1].method).toBe('POST');
    const headers = new Headers(call[1].headers);
    expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(call[1].body as string)).toEqual({
      model: OPENAI_MODERATION_MODEL,
      input: 'a red fox',
    });
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['sexual/minors', 'sexual_minors'],
    ['sexual', 'sexual_explicit'],
    ['violence/graphic', 'graphic_violence'],
    ['hate', 'hate'],
  ])('blocks when OpenAI flags %s (as %s)', async (flag, category) => {
    const result = await moderatePrompt('a red fox', {
      env: remoteEnv,
      fetch: async () => moderationResponse([flag]),
    });
    expect(result).toEqual({
      allowed: false,
      category,
      reason: CATEGORY_REASONS[category as keyof typeof CATEGORY_REASONS],
    });
    expect(logs.info).toHaveBeenCalledWith('Prompt blocked by moderation', {
      category,
      source: 'remote',
    });
  });

  it('reports the most serious flagged category', async () => {
    const result = await moderatePrompt('a red fox', {
      env: remoteEnv,
      fetch: async () => moderationResponse(['violence/graphic', 'sexual/minors', 'sexual']),
    });
    expect(result.category).toBe('sexual_minors');
  });

  it('ignores categories that would reject ordinary creative prompts', async () => {
    const result = await moderatePrompt('a battle', {
      env: remoteEnv,
      fetch: async () => moderationResponse(['violence', 'harassment']),
    });
    expect(result).toEqual({ allowed: true });
  });

  it('does not call the network when a local rule already blocked the prompt', async () => {
    const fetchMock = vi.fn(async () => moderationResponse([]));
    const result = await moderatePrompt('naked woman', { env: remoteEnv, fetch: fetchMock });
    expect(result.allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the network unless MODERATION_PROVIDER=openai', async () => {
    const fetchMock = vi.fn(async () => moderationResponse(['sexual']));
    const result = await moderatePrompt('a red fox', {
      env: envWith({ OPENAI_API_KEY: API_KEY }),
      fetch: fetchMock,
    });
    expect(result).toEqual({ allowed: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('fails open on remote problems, with a warning that leaks nothing', () => {
    const failures: Array<[string, typeof fetch, string]> = [
      ['network error', async () => Promise.reject(new TypeError('fetch failed')), 'network'],
      ['HTTP 500', async () => new Response('boom', { status: 500 }), 'http'],
      ['HTTP 429', async () => new Response('slow down', { status: 429 }), 'http'],
      ['HTTP 401', async () => new Response('{"error":{}}', { status: 401 }), 'http'],
      ['non-JSON body', async () => new Response('<html>', { status: 200 }), 'invalid_response'],
      ['unexpected JSON', async () => Response.json({ nope: true }), 'invalid_response'],
      ['empty results', async () => Response.json({ results: [] }), 'invalid_response'],
      [
        'oversized body',
        async () => new Response('x'.repeat(300_000), { status: 200 }),
        'invalid_response',
      ],
    ];

    it.each(failures)('%s', async (_label, fetchImpl, reason) => {
      const result = await moderatePrompt('a red fox', { env: remoteEnv, fetch: fetchImpl });
      expect(result).toEqual({ allowed: true });
      expect(logs.warn).toHaveBeenCalledWith('Remote moderation failed; allowing the prompt', {
        reason,
      });
      const logged = JSON.stringify(logs.warn.mock.calls);
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain('a red fox');
    });

    it('timeout', async () => {
      const hanging: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      const result = await moderatePrompt('a red fox', {
        env: remoteEnv,
        fetch: hanging,
        remoteTimeoutMs: 20,
      });
      expect(result).toEqual({ allowed: true });
      expect(logs.warn).toHaveBeenCalledWith('Remote moderation failed; allowing the prompt', {
        reason: 'timeout',
      });
    });
  });

  it('never fails open for the local rules, even when the remote check is broken', async () => {
    const result = await moderatePrompt('naked child', {
      env: remoteEnv,
      fetch: async () => Promise.reject(new Error('down')),
    });
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('sexual_minors');
  });

  it('rethrows when the caller aborted, instead of treating it as an outage', async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        controller.abort(new Error('client went away'));
      });
    await expect(
      moderatePrompt('a red fox', { env: remoteEnv, fetch: fetchImpl, signal: controller.signal }),
    ).rejects.toThrow('client went away');
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('skips the remote check with a warning when the key is missing', async () => {
    const fetchMock = vi.fn();
    const env = { ...remoteEnv, OPENAI_API_KEY: undefined };
    const result = await moderatePrompt('a red fox', { env, fetch: fetchMock });
    expect(result).toEqual({ allowed: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.warn).toHaveBeenCalled();
  });
});
