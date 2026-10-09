import { act, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModels } from '@/components/studio/use-models';
import type { ModelDTO } from '@/lib/api-types';
import { DEMO_IMAGE, FLUX_UNAVAILABLE, apiError, json, modelDTO } from '../generations/support';

// `useModels` talks to the real api client; only `fetch` is replaced. Every request waits until the
// test answers it, so the order of events is the test's and not the scheduler's.
interface Request {
  url: string;
  init: RequestInit;
  answer: (models: ModelDTO[]) => void;
  failWith: (status: number) => void;
  dropConnection: () => void;
}

let requests: Request[];
let tabHidden: boolean;
const START = Date.UTC(2026, 0, 1, 12, 0, 0);

function installFetch() {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: string | URL | Request, init: RequestInit = {}) =>
        new Promise<Response>((resolve, reject) => {
          requests.push({
            url: String(input),
            init,
            answer: (models) => resolve(json({ data: models })),
            failWith: (status) => resolve(apiError(status, 'internal_error')),
            dropConnection: () => reject(new TypeError('Failed to fetch')),
          });
        }),
    ),
  );
}

beforeEach(() => {
  installFetch();
  tabHidden = false;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (tabHidden ? 'hidden' : 'visible'),
  });
  // Only the clock: promises, timers and the testing library's polling stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

/** Lets the request chain (fetch, body, parse, state update) run to its end. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

const answer = async (index: number, models: ModelDTO[]) => {
  await act(async () => requests[index]?.answer(models));
  await flush();
};

const passTime = (ms: number) => vi.setSystemTime(Date.now() + ms);

const comeBack = async (how: 'focus' | 'visibility' = 'focus') => {
  await act(async () => {
    if (how === 'focus') window.dispatchEvent(new Event('focus'));
    else document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
};

const WITHOUT_FLUX = () => [DEMO_IMAGE(), FLUX_UNAVAILABLE()];
const WITH_FLUX = () => [DEMO_IMAGE(), modelDTO('fal-flux-schnell')];

async function mountReady(models: ModelDTO[] = WITHOUT_FLUX()) {
  // Counts commits, not renders: a render React throws away is not churn.
  const commits = { count: 0 };
  const view = renderHook(() => {
    const state = useModels();
    useEffect(() => {
      commits.count += 1;
    });
    return state;
  });
  expect(view.result.current.status).toBe('loading');
  await answer(0, models);
  expect(view.result.current.status).toBe('ready');
  const shown = (): ModelDTO[] | undefined => {
    const state = view.result.current;
    return state.status === 'ready' ? state.models : undefined;
  };
  return { ...view, commits, shown };
}

describe('useModels: the first load and reload()', () => {
  it('loads the catalog once, the ordinary cacheable way', async () => {
    const { shown } = await mountReady();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('/api/v1/models');
    expect(Object.keys(requests[0]?.init ?? {})).not.toContain('cache');
    expect(shown()).toEqual(WITHOUT_FLUX());
  });

  it('reports a failure and tries again from scratch on reload()', async () => {
    const view = renderHook(() => useModels());
    await act(async () => requests[0]?.failWith(500));
    await flush();
    expect(view.result.current.status).toBe('error');

    act(() => view.result.current.reload());
    expect(view.result.current.status).toBe('loading');
    expect(requests).toHaveLength(2);
    expect(Object.keys(requests[1]?.init ?? {})).not.toContain('cache');
    await answer(1, WITHOUT_FLUX());
    expect(view.result.current.status).toBe('ready');
  });

  it('does not check quietly while it is still loading or after the load failed', async () => {
    const view = renderHook(() => useModels());
    passTime(60_000);
    await comeBack();
    await comeBack('visibility');
    expect(requests).toHaveLength(1);

    await act(async () => requests[0]?.dropConnection());
    await flush();
    expect(view.result.current.status).toBe('error');
    passTime(60_000);
    await comeBack();
    expect(requests).toHaveLength(1);
  });
});

describe('useModels: checking again when the person comes back', () => {
  it.each(['focus', 'visibility'] as const)(
    'asks once more, skipping the browser cache, on %s (and never shows a loading state)',
    async (how) => {
      const { result } = await mountReady();
      passTime(6_000);
      await act(async () => {
        if (how === 'focus') window.dispatchEvent(new Event('focus'));
        else document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(requests).toHaveLength(2);
      expect(requests[1]?.url).toBe('/api/v1/models');
      expect(requests[1]?.init.cache).toBe('no-store');
      expect(requests[1]?.init.signal).toBeInstanceOf(AbortSignal);
      // The list on screen stays while the quiet check is out.
      expect(result.current.status).toBe('ready');
      await answer(1, WITHOUT_FLUX());
      expect(result.current.status).toBe('ready');
    },
  );

  it('treats the visibilitychange and focus of one return as a single check', async () => {
    await mountReady();
    passTime(30_000);
    await comeBack('visibility');
    await comeBack('focus');
    expect(requests).toHaveLength(2);
  });

  it('puts the models of a provider whose key was added in the meantime on', async () => {
    const { commits, shown } = await mountReady(WITHOUT_FLUX());
    expect(shown()?.find((model) => model.id === 'fal-flux-schnell')?.available).toBe(false);
    const before = commits.count;

    passTime(6_000);
    await comeBack();
    await answer(1, WITH_FLUX());
    expect(shown()?.find((model) => model.id === 'fal-flux-schnell')?.available).toBe(true);
    expect(commits.count).toBe(before + 1);
  });

  it('also picks up a model that appeared or disappeared', async () => {
    const { shown } = await mountReady(WITHOUT_FLUX());
    passTime(6_000);
    await comeBack();
    await answer(1, [DEMO_IMAGE()]);
    expect(shown()?.map((model) => model.id)).toEqual(['aivore-demo-image']);

    passTime(6_000);
    await comeBack();
    await answer(2, [DEMO_IMAGE(), modelDTO('fal-flux-2-pro')]);
    expect(shown()?.map((model) => model.id)).toEqual(['aivore-demo-image', 'fal-flux-2-pro']);
  });

  it('keeps the very same state when nothing changed in availability: no re-render churn', async () => {
    const { commits, shown } = await mountReady(WITHOUT_FLUX());
    const before = shown();
    const rendered = commits.count;

    passTime(6_000);
    await comeBack();
    // A new array with the same content, as every response is.
    await answer(1, WITHOUT_FLUX());
    expect(shown()).toBe(before);
    expect(commits.count).toBe(rendered);

    passTime(6_000);
    await comeBack();
    await answer(2, WITHOUT_FLUX());
    expect(shown()).toBe(before);
    expect(commits.count).toBe(rendered);
  });

  it('keeps the list and says nothing when the quiet check fails, and tries again next time', async () => {
    const { result, commits, shown } = await mountReady(WITHOUT_FLUX());
    const before = shown();
    const rendered = commits.count;

    passTime(6_000);
    await comeBack();
    await act(async () => requests[1]?.failWith(500));
    await flush();
    passTime(6_000);
    await comeBack();
    await act(async () => requests[2]?.dropConnection());
    await flush();
    expect(result.current.status).toBe('ready');
    expect(shown()).toBe(before);
    expect(commits.count).toBe(rendered);

    passTime(6_000);
    await comeBack();
    expect(requests).toHaveLength(4);
    await answer(3, WITH_FLUX());
    expect(shown()?.find((model) => model.id === 'fal-flux-schnell')?.available).toBe(true);
  });
});

describe('useModels: how often it checks', () => {
  it('waits at least 5 seconds after the load, and then after each check', async () => {
    await mountReady();
    await comeBack();
    expect(requests).toHaveLength(1);

    passTime(4_999);
    await comeBack();
    expect(requests).toHaveLength(1);
    passTime(1);
    await comeBack();
    expect(requests).toHaveLength(2);
    await answer(1, WITHOUT_FLUX());

    passTime(4_999);
    await comeBack('visibility');
    expect(requests).toHaveLength(2);
    passTime(1);
    await comeBack('visibility');
    expect(requests).toHaveLength(3);
  });

  it('counts the gap from the check that was started, not from its answer', async () => {
    await mountReady();
    passTime(5_000);
    await comeBack();
    expect(requests).toHaveLength(2);
    // The answer is slow; the gap has run out by the time it arrives.
    passTime(4_000);
    await answer(1, WITHOUT_FLUX());
    passTime(1_000);
    await comeBack();
    expect(requests).toHaveLength(3);
  });

  it('does not check while the tab is hidden, and a hidden event does not use the gap up', async () => {
    await mountReady();
    passTime(60_000);
    tabHidden = true;
    await comeBack('visibility');
    await comeBack('focus');
    expect(requests).toHaveLength(1);

    tabHidden = false;
    await comeBack('visibility');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.init.cache).toBe('no-store');
  });

  it('lets a newer check replace an older one that is still out, and ignores the old answer', async () => {
    const { shown } = await mountReady(WITHOUT_FLUX());
    passTime(6_000);
    await comeBack();
    passTime(6_000);
    await comeBack();
    expect(requests).toHaveLength(3);
    expect(requests[1]?.init.signal?.aborted).toBe(true);
    expect(requests[2]?.init.signal?.aborted).toBe(false);

    // The first answer comes in late, with a list the newer check has already superseded.
    await answer(1, WITH_FLUX());
    expect(shown()?.find((model) => model.id === 'fal-flux-schnell')?.available).toBe(false);
    await answer(2, [DEMO_IMAGE()]);
    expect(shown()?.map((model) => model.id)).toEqual(['aivore-demo-image']);
  });
});

describe('useModels: reload() and unmount while a check is out', () => {
  it('lets reload() win over a quiet check that is still out, and starts listening again afterwards', async () => {
    const { result, shown } = await mountReady(WITHOUT_FLUX());
    passTime(6_000);
    await comeBack();
    expect(requests).toHaveLength(2);

    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    expect(requests[1]?.init.signal?.aborted).toBe(true);
    expect(requests).toHaveLength(3);

    // The quiet answer must not turn the loading state into a stale "ready".
    await answer(1, WITH_FLUX());
    expect(result.current.status).toBe('loading');
    await answer(2, WITHOUT_FLUX());
    expect(shown()?.find((model) => model.id === 'fal-flux-schnell')?.available).toBe(false);

    // The reload counts as a check: too early to ask again, then the usual gap applies.
    await comeBack();
    expect(requests).toHaveLength(3);
    passTime(5_000);
    await comeBack();
    expect(requests).toHaveLength(4);
    expect(requests[3]?.init.cache).toBe('no-store');
  });

  it('removes its listeners and aborts the check in flight on unmount', async () => {
    const { unmount } = await mountReady();
    passTime(6_000);
    await comeBack();
    expect(requests).toHaveLength(2);
    const quiet = requests[1]?.init.signal;
    expect(quiet?.aborted).toBe(false);

    unmount();
    expect(quiet?.aborted).toBe(true);
    passTime(60_000);
    await comeBack();
    await comeBack('visibility');
    expect(requests).toHaveLength(2);
  });

  it('adds one pair of listeners, not one per refresh', async () => {
    const onDocument = vi.spyOn(document, 'addEventListener');
    const onWindow = vi.spyOn(window, 'addEventListener');
    const offDocument = vi.spyOn(document, 'removeEventListener');
    const offWindow = vi.spyOn(window, 'removeEventListener');
    const { unmount } = await mountReady();
    for (let round = 1; round <= 3; round += 1) {
      passTime(6_000);
      await comeBack();
      await answer(round, round % 2 ? WITH_FLUX() : WITHOUT_FLUX());
    }
    const added = (spy: typeof onDocument | typeof onWindow, type: string) =>
      spy.mock.calls.filter(([name]) => name === type);
    // The listeners belong to "ready", which a changed list does not end.
    expect(added(onDocument, 'visibilitychange')).toHaveLength(1);
    expect(added(onWindow, 'focus')).toHaveLength(1);

    unmount();
    const [, handler] = added(onDocument, 'visibilitychange')[0] ?? [];
    expect(added(offDocument, 'visibilitychange').map(([, removed]) => removed)).toContain(handler);
    const [, focusHandler] = added(onWindow, 'focus')[0] ?? [];
    expect(added(offWindow, 'focus').map(([, removed]) => removed)).toContain(focusHandler);
  });
});
