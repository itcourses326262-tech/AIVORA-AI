'use client';

/**
 * Keeps the generations that are still running up to date. Shared by the studio and the gallery.
 *
 * Pass everything that is on screen as `generations`; the hook picks the queued and processing ones
 * and asks `GET /generations?ids=a,b,c` for all of them in one request (50 ids per request at
 * most). It asks again after 1.5 s, and waits longer (x1.5, up to 4 s) while nothing changes. It
 * stops asking while the tab is hidden, asks at once when the tab is shown or focused again, and
 * stops on its own when nothing is active. Failed requests back off instead of hammering a struggling
 * server; a 401 stops the loop and lets `useUser().refresh()` sign the user out of the UI.
 *
 * `onUpdate` receives fresh copies of the generations whose status, progress or results changed.
 * `onGone` receives the ids the server no longer knows (deleted from another tab). When a
 * generation reaches a final state the hook raises a toast (ready / failed, with a "View" action
 * when `onView` is given) and calls `useUser().refresh()`, because a failure refunds credits.
 *
 * The timers, the pending request and the listeners are released when the active set changes or the
 * component unmounts.
 */
import { useEffect, useMemo, useRef } from 'react';
import { isApiError } from '@/lib/api-client';
import { isTerminalStatus, type GenerationDTO } from '@/lib/api-types';
import { isValidId } from '@/lib/id';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { toast } from '@/components/ui/toast';
import { fetchGenerationsByIds, MAX_POLL_IDS } from './api';
import { failureReason, retryAfterSeconds } from './errors';
import { clipText } from './format';

export interface PollingTuning {
  /** Delay after a change, and before the first request. */
  minMs: number;
  /** The longest delay while nothing changes. */
  maxMs: number;
  /** Factor applied to the delay after a request without changes. */
  growth: number;
}

export const DEFAULT_POLLING: PollingTuning = { minMs: 1500, maxMs: 4000, growth: 1.5 };

export interface UseGenerationPollingOptions {
  /** Everything on screen; only queued and processing generations are polled. */
  generations: readonly GenerationDTO[];
  /** Fresh copies of the generations that changed since the last answer. */
  onUpdate: (updated: GenerationDTO[]) => void;
  /** Ids the server did not return (deleted elsewhere). */
  onGone?: (ids: string[]) => void;
  /** Adds a "View" button to the "ready" toast. */
  onView?: (generation: GenerationDTO) => void;
  /** Toasts when a generation finishes or fails. Defaults to true. */
  notify?: boolean;
  tuning?: PollingTuning;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function hasChanged(before: GenerationDTO | undefined, after: GenerationDTO): boolean {
  return (
    before === undefined ||
    before.status !== after.status ||
    before.progress !== after.progress ||
    before.outputs.length !== after.outputs.length
  );
}

export function useGenerationPolling(options: UseGenerationPollingOptions): void {
  const { generations, tuning = DEFAULT_POLLING } = options;
  const { t } = useI18n();
  const { refresh } = useUser();

  const activeIds = useMemo(
    () =>
      generations
        .filter((generation) => !isTerminalStatus(generation.status))
        .map((generation) => generation.id)
        .filter((id) => isValidId(id, 'gen'))
        .toSorted(),
    [generations],
  );
  const activeKey = activeIds.join(',');

  // The loop below outlives renders; it reads the newest props through this ref instead of
  // restarting whenever a callback gets a new identity.
  const latest = useRef({ ...options, t, refresh });
  useEffect(() => {
    latest.current = { ...options, t, refresh };
  });

  const { minMs, maxMs, growth } = tuning;
  useEffect(() => {
    const ids = activeKey === '' ? [] : activeKey.split(',');
    if (ids.length === 0) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let delay = minMs;
    let woke = false;

    const stopTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      stopTimer();
      if (disposed || document.visibilityState === 'hidden') return;
      timer = setTimeout(() => void poll(), delay);
    };

    function announce(generation: GenerationDTO): void {
      const { t: translate, onView } = latest.current;
      const id = `generation-${generation.id}`;
      if (generation.status === 'succeeded') {
        const title =
          generation.kind === 'video'
            ? translate('studio.notify.readyVideo')
            : generation.outputs.length > 1
              ? translate('studio.notify.readyImages')
              : translate('studio.notify.readyImage');
        toast.success(title, {
          id,
          description: clipText(generation.prompt, 80),
          action: onView
            ? { label: translate('studio.notify.view'), onClick: () => onView(generation) }
            : undefined,
        });
      } else if (generation.status === 'failed') {
        toast.error(translate('studio.notify.failed'), {
          id,
          description: `${failureReason(translate, generation)} ${translate('studio.generations.failure.refunded')}`,
        });
      }
    }

    /** Applies an answer; true when anything changed. */
    function apply(fresh: GenerationDTO[]): boolean {
      const current = latest.current;
      const before = new Map(current.generations.map((generation) => [generation.id, generation]));
      const returned = new Set(fresh.map((generation) => generation.id));
      const gone = ids.filter((id) => !returned.has(id));
      const changed = fresh.filter((generation) =>
        hasChanged(before.get(generation.id), generation),
      );

      if (changed.length > 0) current.onUpdate(changed);
      if (gone.length > 0) current.onGone?.(gone);

      let finished = gone.length > 0;
      for (const generation of changed) {
        const previous = before.get(generation.id);
        if (previous && !isTerminalStatus(previous.status) && isTerminalStatus(generation.status)) {
          finished = true;
          if (current.notify !== false) announce(generation);
        }
      }
      if (finished) void current.refresh();
      return changed.length > 0 || gone.length > 0;
    }

    async function poll(): Promise<void> {
      stopTimer();
      if (disposed || document.visibilityState === 'hidden') return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const answers = await Promise.all(
          chunk(ids, MAX_POLL_IDS).map((batch) => fetchGenerationsByIds(batch, request.signal)),
        );
        if (disposed || request.signal.aborted) return;
        // The first answer after waking up does not count as "nothing changed": the loop starts
        // over at the short interval.
        const changed = apply(answers.flat());
        delay = changed || woke ? minMs : Math.min(maxMs, Math.round(delay * growth));
        woke = false;
      } catch (error) {
        if (disposed || request.signal.aborted) return;
        // Signed out: nothing here can succeed, and refresh() clears the user so the UI follows.
        if (isApiError(error) && error.status === 401) {
          void latest.current.refresh();
          return;
        }
        const wait = (retryAfterSeconds(error) ?? 0) * 1000;
        delay = Math.max(wait, Math.min(maxMs, delay * 2));
      }
      schedule();
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopTimer();
        controller?.abort();
        return;
      }
      wake();
    };
    const wake = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      delay = minMs;
      woke = true;
      void poll();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', wake);
    schedule();

    return () => {
      disposed = true;
      stopTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', wake);
    };
  }, [activeKey, minMs, maxMs, growth]);
}
