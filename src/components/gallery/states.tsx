'use client';

import { ImagePlus, SearchX } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';

const SHAPES = ['aspect-square', 'aspect-[4/5]', 'aspect-[16/10]', 'aspect-[3/4]'] as const;

/** Placeholder cards while the first page loads; their shapes differ like real results do. */
export function GallerySkeleton({ count = 8, className }: { count?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', className)}
    >
      <span className="sr-only">{t('gallery.list.loading')}</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-border bg-surface">
          <Skeleton className={cn('w-full rounded-none', SHAPES[index % SHAPES.length])} />
          <div className="grid gap-2 p-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The person has not created anything yet: say so and offer the studio. */
export function NoCreations() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<ImagePlus />}
      title={t('gallery.list.empty.title')}
      description={t('gallery.list.empty.description')}
      headingLevel={2}
      action={
        <Button href="/studio" size="lg">
          {t('gallery.list.empty.action')}
        </Button>
      }
    />
  );
}

/** Filters or a search matched nothing: say what was asked for and how to get everything back. */
export function NoResults({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<SearchX />}
      title={t('gallery.list.noResults.title')}
      description={t('gallery.list.noResults.description')}
      headingLevel={2}
      action={
        <Button variant="secondary" onClick={onClear}>
          {t('gallery.list.filters.clear')}
        </Button>
      }
    />
  );
}
