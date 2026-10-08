'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { ErrorState } from '../ui/error-state';

export interface LoadMoreProps {
  /** Another page exists. */
  hasMore: boolean;
  loading: boolean;
  /** Why the last attempt failed; it stops the automatic loading until the person retries. */
  error?: unknown;
  onLoadMore: () => void;
}

/**
 * The foot of an endless list. The next page loads by itself when this block comes near the screen,
 * and the button does the same on demand (keyboard and screen-reader users, and a failed attempt:
 * nothing is retried in a loop).
 */
export function LoadMore({ hasMore, loading, error, onLoadMore }: LoadMoreProps) {
  const { t } = useI18n();
  const anchor = useRef<HTMLDivElement>(null);
  const failed = error !== undefined;

  useEffect(() => {
    const node = anchor.current;
    if (!node || !hasMore || loading || failed || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, failed, onLoadMore]);

  if (!hasMore) return null;
  return (
    <div ref={anchor} className="flex flex-col items-center gap-3 pt-2">
      {failed ? (
        <ErrorState
          title={t('gallery.loadMore.failed')}
          error={error}
          headingLevel={3}
          className="w-full max-w-md py-6"
        />
      ) : null}
      <Button variant="secondary" loading={loading} onClick={onLoadMore}>
        {loading
          ? t('gallery.loadMore.loading')
          : failed
            ? t('common.actions.retry')
            : t('gallery.loadMore.action')}
      </Button>
    </div>
  );
}
