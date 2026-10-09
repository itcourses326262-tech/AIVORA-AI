import { ChevronDown } from 'lucide-react';

export interface LegalTocItem {
  /** Anchor of the section (`#id`). */
  id: string;
  /** Section number in the active language's digits. */
  number: string;
  title: string;
}

const linkClass =
  'flex items-baseline gap-2.5 rounded-md py-1.5 text-sm text-muted transition-colors duration-150 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:items-center';

function TocList({ items }: { items: readonly LegalTocItem[] }) {
  return (
    <ol className="grid gap-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} className={linkClass}>
            <span aria-hidden="true" className="w-5 shrink-0 text-subtle tabular-nums">
              {item.number}
            </span>
            <span>{item.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The table of contents. From `lg` it is a sticky list beside the text (the page's landmark);
 * below it is a collapsed disclosure above the text, so a phone does not scroll past a dozen
 * links before the first paragraph. Both are left out of a printout.
 *
 * The sticky list is never taller than the window below the site header: the Terms have 17
 * sections, which is more than a laptop screen holds, so the list scrolls on its own instead of
 * leaving the last sections out of reach. The padding (undone by the equal negative margin) keeps
 * the keyboard focus ring of a link from being clipped by that scrolling box.
 */
export function LegalToc({ label, items }: { label: string; items: readonly LegalTocItem[] }) {
  return (
    <>
      <nav
        aria-label={label}
        className="hidden lg:sticky lg:top-24 lg:-m-1.5 lg:block lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:p-1.5 print:hidden"
      >
        <p className="mb-2 text-sm font-semibold text-foreground">{label}</p>
        <TocList items={items} />
      </nav>
      <details className="group rounded-2xl border border-border bg-surface/60 lg:hidden print:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          {label}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted transition-transform duration-150 group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-border px-4 py-2">
          <TocList items={items} />
        </div>
      </details>
    </>
  );
}
