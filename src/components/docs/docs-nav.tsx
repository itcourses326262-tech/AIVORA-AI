'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DocsNavNode {
  /** The id of the element it scrolls to. */
  id: string;
  label: string;
  /** A short mono prefix, such as the HTTP method of an endpoint. */
  badge?: string;
  children?: readonly DocsNavNode[];
}

export interface DocsNavProps {
  nodes: readonly DocsNavNode[];
  /** Names the navigation landmark and heads the mobile button. */
  title: string;
}

/** How far below the top of the viewport a heading counts as "the one being read". */
const READING_OFFSET_PX = 120;

function flatten(nodes: readonly DocsNavNode[]): DocsNavNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/**
 * The section being read: the last anchor whose top has passed the reading line. Anchors are in
 * document order, so the scan stops at the first one still below it.
 */
export function currentSection(
  ids: readonly string[],
  offset = READING_OFFSET_PX,
): string | undefined {
  let current = ids[0];
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.getBoundingClientRect().top <= offset) current = id;
    else break;
  }
  return current;
}

function useScrollSpy(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setActive(currentSection(ids));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
    };
  }, [ids]);
  return active;
}

function NavItems({
  nodes,
  active,
  onNavigate,
  nested = false,
}: {
  nodes: readonly DocsNavNode[];
  active: string | undefined;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  return (
    <ul className={cn('grid gap-0.5', nested && 'ms-3 mt-0.5 border-s border-border ps-2')}>
      {nodes.map((node) => {
        const current = node.id === active;
        return (
          <li key={node.id}>
            <a
              href={`#${node.id}`}
              aria-current={current ? 'location' : undefined}
              onClick={onNavigate}
              className={cn(
                'flex min-h-8 items-baseline gap-2 rounded-md px-2 py-1 text-sm transition-colors duration-150 pointer-coarse:min-h-11 pointer-coarse:items-center',
                nested ? 'text-[0.8125rem]' : 'font-medium',
                current
                  ? 'bg-brand-soft text-foreground'
                  : 'text-muted hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              {node.badge ? (
                <span
                  dir="ltr"
                  className="w-10 shrink-0 font-mono text-[0.625rem] font-semibold tracking-wide text-subtle uppercase"
                >
                  {node.badge}
                </span>
              ) : null}
              <span className="min-w-0 break-words">{node.label}</span>
            </a>
            {node.children && node.children.length > 0 ? (
              <NavItems nodes={node.children} active={active} onNavigate={onNavigate} nested />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The table of contents: a sticky sidebar from `lg`, and below it a bar under the site header that
 * opens the same list. The section being read is highlighted and the sidebar scrolls to keep it in
 * view.
 */
export function DocsNav({ nodes, title }: DocsNavProps) {
  const flat = useMemo(() => flatten(nodes), [nodes]);
  const ids = useMemo(() => flat.map((node) => node.id), [flat]);
  const active = useScrollSpy(ids);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const sidebar = useRef<HTMLDivElement>(null);
  const activeLabel = flat.find((node) => node.id === active)?.label;

  // Keep the highlighted link inside the sidebar's own scroll area (never scrolls the page).
  useEffect(() => {
    const container = sidebar.current;
    const link = container?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!container || !link) return;
    const top = link.offsetTop - container.offsetTop;
    if (top < container.scrollTop) container.scrollTop = Math.max(0, top - 8);
    else if (top + link.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = top + link.offsetHeight - container.clientHeight + 8;
    }
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <div className="sticky top-16 z-30 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex h-12 w-full cursor-pointer items-center justify-between gap-3 text-start text-sm font-medium"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-muted">{title}</span>
            <span className="truncate">{activeLabel}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
        <nav
          id={panelId}
          aria-label={title}
          hidden={!open}
          className="max-h-[60dvh] overflow-y-auto pb-3"
        >
          <NavItems nodes={nodes} active={active} onNavigate={() => setOpen(false)} />
        </nav>
      </div>

      <nav
        aria-label={title}
        className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] self-start lg:block"
      >
        <div ref={sidebar} className="max-h-[inherit] overflow-y-auto pe-3 pb-6">
          <NavItems nodes={nodes} active={active} />
        </div>
      </nav>
    </>
  );
}
