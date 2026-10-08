'use client';

import { useI18n } from '@/lib/i18n/client';
import { Skeleton } from '../ui/skeleton';

/**
 * The studio before it knows how wide the screen is (and while the route loads): the shape of both
 * layouts, drawn with CSS only, so the server HTML and the first client render agree.
 */
export function StudioSkeleton() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]"
    >
      <span className="sr-only">{t('common.a11y.loading')}</span>
      <div
        aria-hidden="true"
        className="hidden h-[calc(100dvh-3.5rem)] gap-5 border-e border-border bg-surface p-4 lg:grid lg:content-start"
      >
        <div className="grid grid-cols-2 gap-1">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
      <div aria-hidden="true" className="grid content-start gap-4 p-4 lg:p-6">
        <Skeleton className="h-14 rounded-xl lg:hidden" />
        <Skeleton className="h-7 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="overflow-hidden rounded-2xl border border-border bg-surface"
            >
              <Skeleton className="aspect-square rounded-none" />
              <div className="grid gap-2 p-3">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
