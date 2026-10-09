import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModels } from '@/lib/generations/api';
import { DEMO_IMAGE, FLUX_UNAVAILABLE, json } from './support';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const stub = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    json({ data: [DEMO_IMAGE(), FLUX_UNAVAILABLE()] }),
  );
  vi.stubGlobal('fetch', stub);
  return stub;
}

describe('fetchModels', () => {
  it('reads the catalog from /models with the browser caching it normally', async () => {
    const stub = stubFetch();
    await expect(fetchModels()).resolves.toEqual([DEMO_IMAGE(), FLUX_UNAVAILABLE()]);
    expect(stub).toHaveBeenCalledOnce();
    const [url, init] = stub.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/models');
    expect(init?.method).toBe('GET');
    expect(Object.keys(init ?? {})).not.toContain('cache');
  });

  it('is not made fresh by an empty options object or fresh: false', async () => {
    const stub = stubFetch();
    await fetchModels(undefined, {});
    await fetchModels(undefined, { fresh: false });
    for (const [, init] of stub.mock.calls) expect(Object.keys(init ?? {})).not.toContain('cache');
  });

  it('skips the browser cache when asked for a fresh answer, and still passes the signal', async () => {
    const stub = stubFetch();
    const controller = new AbortController();
    await fetchModels(controller.signal, { fresh: true });
    const init = stub.mock.calls[0]?.[1];
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBe(controller.signal);
  });
});
