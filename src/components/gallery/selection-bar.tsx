'use client';

import { Heart, HeartOff, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { SpinnerIcon } from '../ui/spinner-icon';
import { countForms } from './plural';

/** A bulk action that is running. */
export interface BulkProgress {
  kind: 'favorite' | 'delete';
  done: number;
  total: number;
  /** The run is waiting for the rate limit to clear. */
  waiting: boolean;
}

export interface SelectionBarProps {
  /** Chosen creations. */
  count: number;
  /** Creations on screen: what "select all" would choose. */
  loaded: number;
  /** Chosen creations that can be favorited (finished ones). */
  favoritable: number;
  /** Every favoritable chosen creation is a favorite already: the action then removes them. */
  allFavorites: boolean;
  progress: BulkProgress | null;
  onSelectAll: () => void;
  onClear: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onExit: () => void;
  className?: string;
}

/** The bar of multi-select mode: what is chosen and what can be done with it. */
export function SelectionBar({
  count,
  loaded,
  favoritable,
  allFavorites,
  progress,
  onSelectAll,
  onClear,
  onFavorite,
  onDelete,
  onExit,
  className,
}: SelectionBarProps) {
  const { t, plural } = useI18n();
  const busy = progress !== null;

  return (
    <div
      role="region"
      aria-label={t('gallery.select.bar')}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border-strong surface-glass p-3 shadow-lg',
        className,
      )}
    >
      <p aria-live="polite" className="me-auto text-sm font-medium text-foreground tabular-nums">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <SpinnerIcon className="size-4 text-brand" />
            {progress.waiting
              ? t('gallery.select.waiting')
              : t(
                  progress.kind === 'delete'
                    ? 'gallery.select.deleting'
                    : 'gallery.select.updating',
                  { done: progress.done, total: progress.total },
                )}
          </span>
        ) : count === 0 ? (
          t('gallery.select.none')
        ) : (
          plural(count, countForms(t, 'gallery.select.count'))
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {count < loaded ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onSelectAll}>
            {t('gallery.select.all')}
          </Button>
        ) : null}
        {count > 0 ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
            {t('gallery.select.clear')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || favoritable === 0}
          startIcon={allFavorites ? <HeartOff /> : <Heart />}
          onClick={onFavorite}
        >
          {allFavorites ? t('gallery.select.unfavorite') : t('gallery.select.favorite')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy || count === 0}
          startIcon={<Trash2 />}
          onClick={onDelete}
        >
          {t('gallery.select.delete')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onExit}>
          {t('gallery.select.done')}
        </Button>
      </div>
    </div>
  );
}
