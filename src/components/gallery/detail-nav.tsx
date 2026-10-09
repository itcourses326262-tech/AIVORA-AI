'use client';

import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { isRtl } from '../ui/dir';
import { Directional } from '../ui/icon';
import { detailHref } from './links';
import type { Neighbors } from './nav-snapshot';

export interface DetailNavProps {
  /** Where "back" goes: the list the person came from, filters included. */
  backHref: string;
  /** Previous and next in that list, or null when the person did not come from it. */
  neighbors: Neighbors | null;
}

/**
 * Places where the arrow keys already mean something: text fields, a media player (seek), sliders
 * and groups of options, and anything that opened above the page. A key press there is not ours.
 */
const OWN_ARROW_KEYS = [
  'input',
  'textarea',
  'select',
  'video',
  'audio',
  '[contenteditable="true"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="slider"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="listbox"]',
].join(', ');

function ownsArrowKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWN_ARROW_KEYS) !== null;
}

/**
 * The bar above a creation: back to the list, and, when the person came from it, previous / next
 * within that same list with the arrow keys as a shortcut (they follow what the user sees, so they
 * swap in Arabic). "Previous" is the creation above this one in the list, which is the newer one.
 */
export function DetailNav({ backHref, neighbors }: DetailNavProps) {
  const { t } = useI18n();
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  const previous = neighbors?.previous ?? null;
  const next = neighbors?.next ?? null;

  useEffect(() => {
    if (!previous && !next) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // A held key repeats: one press goes one step, not a burst of page loads.
      if (event.repeat || ownsArrowKeys(event.target)) return;
      const forward = (event.key === 'ArrowRight') !== isRtl(root.current);
      const id = forward ? next : previous;
      if (!id) return;
      event.preventDefault();
      router.push(detailHref(id));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [previous, next, router]);

  return (
    <nav
      ref={root}
      aria-label={t('gallery.detail.navigation')}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <Button
        href={backHref}
        variant="ghost"
        size="sm"
        className="-ms-2"
        startIcon={
          <Directional>
            <ArrowLeft className="size-4" />
          </Directional>
        }
      >
        {t('gallery.detail.back')}
      </Button>
      {neighbors ? (
        <div className="flex items-center gap-1">
          <p aria-live="polite" className="me-1 text-sm text-muted tabular-nums">
            {t('gallery.detail.position', {
              index: neighbors.position,
              total: neighbors.total,
            })}
          </p>
          <DetailStep id={previous} label={t('gallery.detail.previous')}>
            <ChevronLeft />
          </DetailStep>
          <DetailStep id={next} label={t('gallery.detail.next')}>
            <ChevronRight />
          </DetailStep>
        </div>
      ) : null}
    </nav>
  );
}

/** A previous / next button: a link while there is somewhere to go, a disabled button at the ends. */
function DetailStep({
  id,
  label,
  children,
}: {
  id: string | null;
  label: string;
  children: ReactNode;
}) {
  const className = 'size-10 px-0 pointer-coarse:size-11';
  return id ? (
    <Button href={detailHref(id)} variant="outline" aria-label={label} className={className}>
      <Directional>{children}</Directional>
    </Button>
  ) : (
    <Button variant="outline" aria-label={label} disabled className={className}>
      <Directional>{children}</Directional>
    </Button>
  );
}
