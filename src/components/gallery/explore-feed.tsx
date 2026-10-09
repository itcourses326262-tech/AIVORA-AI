'use client';

import { Compass } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Masonry } from '@/components/generations';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { estimateExploreHeight, ExploreCard } from './explore-card';
import { exploreHref, type ExploreKind } from './explore';
import { fetchExplorePage } from './gallery-api';
import { LoadMore } from './load-more';
import { toPublicCreation, type PublicCreation } from './public-creation';
import { useHydrated } from './use-hydrated';

export interface ExploreFeedProps {
  kind: ExploreKind;
  /** The first page, read on the server so crawlers and slow connections get real content. */
  initialItems: PublicCreation[];
  /** Cursor of the second page, or null when the first one was the last. */
  initialCursor: string | null;
  /** Where the "empty" state sends people. */
  createHref: string;
  createLabel: string;
}

/** Pictures above the fold; the rest load lazily. */
const EAGER_COUNT = 4;

/**
 * The public feed: masonry of shared creations with "load more" by cursor. The first page comes
 * from the server, the following ones from `GET /explore`. The server cannot know how many columns
 * fit, so the grid stays invisible (and short) until the browser has laid it out.
 */
export function ExploreFeed({
  kind,
  initialItems,
  initialCursor,
  createHref,
  createLabel,
}: ExploreFeedProps) {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const busy = useRef(false);

  const loadMore = useCallback(() => {
    if (cursor === null || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(undefined);
    fetchExplorePage({ kind: kind === 'all' ? undefined : kind, cursor }).then(
      (page) => {
        busy.current = false;
        setLoading(false);
        setCursor(page.nextCursor);
        setItems((current) => {
          const known = new Set(current.map((item) => item.id));
          const fresh = page.data
            .map(toPublicCreation)
            .filter((item) => !known.has(item.id) && item.outputs.length > 0);
          return [...current, ...fresh];
        });
      },
      (failure: unknown) => {
        busy.current = false;
        setLoading(false);
        setError(failure);
      },
    );
  }, [cursor, kind]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Compass />}
        title={t(
          kind === 'all' ? 'gallery.explore.empty.title' : `gallery.explore.empty.${kind}.title`,
        )}
        description={t(
          kind === 'all' ? 'gallery.explore.empty.description' : 'gallery.explore.empty.filtered',
        )}
        headingLevel={2}
        action={
          <>
            {kind === 'all' ? null : (
              <Button href={exploreHref('all')} variant="secondary">
                {t('gallery.explore.empty.all')}
              </Button>
            )}
            <Button href={createHref}>{createLabel}</Button>
          </>
        }
      />
    );
  }

  return (
    <section aria-label={t('gallery.explore.feed')} className="grid grid-cols-1 gap-6">
      {/* Without scripts nothing would ever reveal the grid: show it as the server laid it out. */}
      <noscript>
        <style>
          {
            '.explore-feed{opacity:1!important;max-height:none!important;overflow:visible!important}'
          }
        </style>
      </noscript>
      <div
        className={cn(
          'explore-feed transition-opacity duration-300',
          hydrated ? 'opacity-100' : 'max-h-[70dvh] overflow-hidden opacity-0',
        )}
      >
        <Masonry
          items={items}
          getKey={(item) => item.id}
          estimateHeight={estimateExploreHeight}
          minColumnWidth={240}
          maxColumns={5}
          renderItem={(item) => (
            <ExploreCard creation={item} eager={items.indexOf(item) < EAGER_COUNT} />
          )}
        />
      </div>
      <LoadMore hasMore={cursor !== null} loading={loading} error={error} onLoadMore={loadMore} />
    </section>
  );
}
