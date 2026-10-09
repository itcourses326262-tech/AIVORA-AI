'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { EXPLORE_KINDS, exploreHref, type ExploreKind } from './explore';

export interface ExploreKindNavProps {
  kind: ExploreKind;
}

/**
 * All / Images / Videos as links, so every filter is an address of its own that a crawler or a
 * shared link can reach. The look is that of the studio's segmented control.
 */
export function ExploreKindNav({ kind }: ExploreKindNavProps) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('gallery.list.filters.kind.label')}>
      <ul className="inline-flex gap-1 rounded-xl border border-border bg-surface p-1">
        {EXPLORE_KINDS.map((value) => {
          const current = value === kind;
          return (
            <li key={value}>
              <Link
                href={exploreHref(value)}
                aria-current={current ? 'page' : undefined}
                data-state={current ? 'checked' : 'unchecked'}
                className={cn(
                  'inline-flex h-8 items-center justify-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap text-muted transition-[background-color,color,box-shadow] duration-150 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:min-w-11',
                  'data-[state=checked]:bg-surface-overlay data-[state=checked]:text-foreground data-[state=checked]:shadow-sm data-[state=checked]:ring-1 data-[state=checked]:ring-field',
                )}
              >
                {t(`gallery.list.filters.kind.${value}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
