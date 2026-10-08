import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, toast } from '@/components/ui/toast';
import type { GenerationDTO } from '@/lib/api-types';
import {
  DEFAULT_POLLING,
  useGenerationPolling,
  type UseGenerationPollingOptions,
} from '@/lib/generations/use-generation-polling';
import { UserProvider } from '@/lib/user-context';
import { renderUi } from '../render';
import { USER, apiError, assetDTO, generationDTO, installFakeApi, type FakeApi } from './support';

function Harness(props: UseGenerationPollingOptions) {
  useGenerationPolling(props);
  return null;
}

function mount(generations: GenerationDTO[], extra: Partial<UseGenerationPollingOptions> = {}) {
  const onUpdate = vi.fn();
  const onGone = vi.fn();
  const view = renderUi(
    <UserProvider initialUser={USER}>
      <Toaster />
      <Harness generations={generations} onUpdate={onUpdate} onGone={onGone} {...extra} />
    </UserProvider>,
  );
  return { onUpdate, onGone, ...view };
}

const running = (overrides: Partial<GenerationDTO> = {}) =>
  generationDTO({ status: 'processing', progress: 10, outputs: [], ...overrides });

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const polls = (api: FakeApi) => api.callsTo('GET', '/generations?ids=');
const hidden = { value: false };

let api: FakeApi;

beforeEach(() => {
  vi.useFakeTimers();
  api = installFakeApi();
  hidden.value = false;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden.value ? 'hidden' : 'visible'),
  });
});

afterEach(() => {
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useGenerationPolling', () => {
  it('asks for every running generation in one request, after the first interval', async () => {
    const a = running();
    const b = running({ status: 'queued', progress: 0 });
    const done = generationDTO();
    api.generations = [a, b, done];
    mount([a, b, done]);

    await advance(DEFAULT_POLLING.minMs - 1);
    expect(polls(api)).toHaveLength(0);
    await advance(1);
    expect(polls(api)).toHaveLength(1);
    const ids = new URL(`http://x${polls(api)[0]?.path}`).searchParams.get('ids')?.split(',');
    // Sorted, and the finished one is not polled.
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it('does nothing while nothing is running', async () => {
    mount([generationDTO(), generationDTO({ status: 'failed', outputs: [] })]);
    await advance(20_000);
    expect(polls(api)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits longer and longer while nothing changes, up to the cap', async () => {
    const a = running();
    api.generations = [a];
    mount([a]);
    const times: number[] = [];
    const start = Date.now();
    api.intercept((call) => {
      if (call.path.startsWith('/generations?ids=')) times.push(Date.now() - start);
      return undefined;
    });

    await advance(20_000);
    // 1.5 s, then x1.5 each time (2.25 s, 3.375 s), then 4 s forever.
    const gaps = times.slice(1).map((time, index) => time - (times[index] as number));
    expect(times[0]).toBe(1500);
    expect(gaps.slice(0, 4)).toEqual([2250, 3375, 4000, 4000]);
    expect(Math.max(...gaps)).toBe(4000);
  });

  it('goes back to the short interval after something changes', async () => {
    const a = running();
    api.generations = [a];
    const { onUpdate, rerender } = mount([a]);
    await advance(1500 + 2250 + 3375);
    expect(polls(api)).toHaveLength(3);

    // Progress moves on the server: the next answer is a change.
    api.generations = [{ ...a, progress: 55 }];
    await advance(4000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ id: a.id, progress: 55 }),
    ]);

    // The page applies the update; the loop keeps its short pace.
    rerender(
      <UserProvider initialUser={USER}>
        <Toaster />
        <Harness generations={[{ ...a, progress: 55 }]} onUpdate={onUpdate} />
      </UserProvider>,
    );
    const before = polls(api).length;
    await advance(1500);
    expect(polls(api).length).toBe(before + 1);
  });

  it('toasts, and refreshes the credit balance, when a generation finishes', async () => {
    const a = running({ prompt: 'A lighthouse at sunset' });
    api.generations = [a];
    const { onUpdate } = mount([a], { onView: vi.fn() });
    api.generations = [
      { ...a, status: 'succeeded', progress: 100, outputs: [assetDTO()], finishedAt: Date.now() },
    ];
    api.balance = 49;
    const meCalls = () => api.callsTo('GET', '/auth/me').length;
    const before = meCalls();

    await advance(1500);
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ status: 'succeeded' })]);
    expect(screen.getByText('Your image is ready')).toBeInTheDocument();
    expect(screen.getByText('A lighthouse at sunset')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(meCalls()).toBe(before + 1);
    expect(screen.getByRole('status', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('says "video" for a video and "images" for several results', async () => {
    const video = running({ kind: 'video', tool: 'text-to-video' });
    const images = running({ params: { aspectRatio: '1:1', count: 2 } });
    api.generations = [
      {
        ...video,
        status: 'succeeded',
        outputs: [assetDTO({ kind: 'video', mimeType: 'image/gif' })],
      },
      { ...images, status: 'succeeded', outputs: [assetDTO(), assetDTO()] },
    ];
    mount([video, images]);
    await advance(1500);
    expect(screen.getByText('Your video is ready')).toBeInTheDocument();
    expect(screen.getByText('Your images are ready')).toBeInTheDocument();
  });

  it('toasts the reason for a failure and says the credits came back', async () => {
    const a = running();
    api.generations = [
      { ...a, status: 'failed', error: { code: 'content_policy', message: 'blocked' } },
    ];
    mount([a]);
    await advance(1500);
    expect(screen.getByText('The generation failed')).toBeInTheDocument();
    expect(screen.getByText(/content policy.*Your credits were refunded/)).toBeInTheDocument();
  });

  it('stays quiet when a generation was canceled, and when notifications are off', async () => {
    const a = running();
    const b = running();
    api.generations = [
      { ...a, status: 'canceled' },
      { ...b, status: 'succeeded', outputs: [assetDTO()] },
    ];
    mount([a, b], { notify: false });
    await advance(1500);
    expect(screen.queryByText('Your image is ready')).not.toBeInTheDocument();
    expect(screen.queryByText('The generation failed')).not.toBeInTheDocument();
    // The balance is still refreshed: a cancel refunds.
    expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);
  });

  it('stops asking when the tab is hidden, and asks at once when it is shown again', async () => {
    const a = running();
    api.generations = [a];
    mount([a]);
    await advance(1500);
    expect(polls(api)).toHaveLength(1);

    hidden.value = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(30_000);
    expect(polls(api)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    hidden.value = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(0);
    expect(polls(api)).toHaveLength(2);
  });

  it('asks at once when the window gets focus, and goes back to the short interval', async () => {
    const a = running();
    api.generations = [a];
    mount([a]);
    await advance(1500 + 2250 + 3375 + 4000);
    const before = polls(api).length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(0);
    expect(polls(api).length).toBe(before + 1);
    await advance(1500);
    expect(polls(api).length).toBe(before + 2);
  });

  it('reports ids the server no longer knows (deleted from another tab)', async () => {
    const a = running();
    const b = running();
    api.generations = [b];
    const { onGone } = mount([a, b]);
    await advance(1500);
    expect(onGone).toHaveBeenCalledWith([a.id]);
  });

  it('splits more than 50 running generations over several requests', async () => {
    const many = Array.from({ length: 120 }, () => running());
    api.generations = many;
    mount(many);
    await advance(1500);
    const batches = polls(api).map(
      (call) => new URL(`http://x${call.path}`).searchParams.get('ids')?.split(',').length,
    );
    expect(batches.sort()).toEqual([20, 50, 50]);
  });

  it('never asks for a placeholder that has no real id yet', async () => {
    const real = running();
    const optimistic = running({ id: 'local-1' });
    api.generations = [real];
    mount([optimistic, real]);
    await advance(1500);
    const ids = new URL(`http://x${polls(api)[0]?.path}`).searchParams.get('ids');
    expect(ids).toBe(real.id);
  });

  it('backs off after a failed request and keeps going', async () => {
    const a = running();
    api.generations = [a];
    let fail = 2;
    api.intercept((call) => {
      if (call.path.startsWith('/generations?ids=') && fail-- > 0) {
        return apiError(500, 'internal');
      }
      return undefined;
    });
    const { onUpdate } = mount([a]);
    api.generations = [{ ...a, progress: 80 }];
    await advance(1500);
    expect(onUpdate).not.toHaveBeenCalled();
    await advance(3000);
    expect(onUpdate).not.toHaveBeenCalled();
    await advance(4000);
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ progress: 80 })]);
  });

  it('honors Retry-After style hints of a rate limit', async () => {
    const a = running();
    api.generations = [a];
    let limited = true;
    api.intercept((call) => {
      if (call.path.startsWith('/generations?ids=') && limited) {
        limited = false;
        return apiError(429, 'rate_limited', { retryAfterSec: 9 });
      }
      return undefined;
    });
    mount([a]);
    await advance(1500);
    expect(polls(api)).toHaveLength(1);
    await advance(8000);
    expect(polls(api)).toHaveLength(1);
    await advance(1100);
    expect(polls(api)).toHaveLength(2);
  });

  it('gives up quietly when the session ended (401) and refreshes the user instead', async () => {
    const a = running();
    api.generations = [a];
    api.intercept((call) =>
      call.path.startsWith('/generations?ids=') ? apiError(401, 'unauthorized') : undefined,
    );
    mount([a]);
    await advance(1500);
    expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);
    await advance(30_000);
    expect(polls(api)).toHaveLength(1);
  });

  it('releases its timers, request and listeners on unmount', async () => {
    const a = running();
    api.generations = [a];
    const { unmount } = mount([a]);
    await advance(1500);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const before = polls(api).length;
    const removed = vi.spyOn(document, 'removeEventListener');

    unmount();
    expect(removed).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    await advance(30_000);
    expect(polls(api).length).toBe(before);
  });

  it('does not answer into an unmounted page when a request is still in flight', async () => {
    const a = running();
    api.generations = [{ ...a, progress: 90 }];
    let release: (() => void) | undefined;
    api.intercept(async (call) => {
      if (!call.path.startsWith('/generations?ids=')) return undefined;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return undefined;
    });
    const { onUpdate, unmount } = mount([a]);
    await advance(1500);
    unmount();
    release?.();
    await advance(10);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('restarts with the new set when a generation is added, and stops when all are done', async () => {
    const a = running();
    const b = running();
    api.generations = [a, b];
    const { rerender } = mount([a]);
    await advance(1500);
    expect(new URL(`http://x${polls(api)[0]?.path}`).searchParams.get('ids')).toBe(a.id);

    rerender(
      <UserProvider initialUser={USER}>
        <Toaster />
        <Harness generations={[b, a]} onUpdate={vi.fn()} />
      </UserProvider>,
    );
    await advance(1500);
    const last = polls(api).at(-1);
    expect(new URL(`http://x${last?.path}`).searchParams.get('ids')?.split(',').sort()).toEqual(
      [a.id, b.id].sort(),
    );

    rerender(
      <UserProvider initialUser={USER}>
        <Toaster />
        <Harness
          generations={[
            { ...a, status: 'succeeded' },
            { ...b, status: 'failed' },
          ]}
          onUpdate={vi.fn()}
        />
      </UserProvider>,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
