import Link from 'next/link';
import type { ReactNode } from 'react';
import { DraftNotice } from './draft-notice';
import { LegalToc, type LegalTocItem } from './legal-toc';

export interface LegalSectionData extends LegalTocItem {
  /** The section's content, rendered under its heading. */
  children: ReactNode;
}

export interface LegalPageProps {
  eyebrow: string;
  title: string;
  /** One or two sentences under the title. */
  summary: string;
  /** "Last updated 8 October 2026", already localized. */
  updatedLabel: string;
  /** The same date as `YYYY-MM-DD`, for the `<time>` element. */
  updatedIso: string;
  /** The "Draft — pending legal review" notice; `null` once counsel has approved the text. */
  draft: { title: string; body: string } | null;
  tocLabel: string;
  sections: readonly LegalSectionData[];
  related: { label: string; links: ReadonlyArray<{ href: string; label: string }> };
}

/**
 * A paper copy shows the document and nothing else: no site header or footer, no table of
 * contents, and colours that read on white whatever theme the reader had on screen. (Browsers
 * leave backgrounds out of a printout, so a light-on-dark theme would otherwise print as near
 * white text on white paper.)
 */
const PRINT_CSS = `@page { margin: 16mm; }
@media print {
  body header, body footer { display: none !important; }
  html:root[data-theme] {
    --background: #fff; --surface: #fff; --foreground: #111; --muted: #333; --subtle: #444;
    --border: #bbb; --border-strong: #888; --brand: #1f2a9c; --warning: #7a3e00; --warning-soft: #fdf3e3;
  }
  body { background: #fff; }
}`;

const relatedLinkClass =
  'inline-flex items-center rounded-sm py-1.5 text-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand pointer-coarse:min-h-11';

/**
 * The page every legal document uses: title block, optional draft notice, a table of contents with
 * anchors, numbered sections in readable measure, and links to the other documents. It renders the
 * one `<main id="main-content">` of the page and takes only text, so it works in server components
 * and tests; `LegalDocument` fills it from the dictionaries.
 */
export function LegalPage({
  eyebrow,
  title,
  summary,
  updatedLabel,
  updatedIso,
  draft,
  tocLabel,
  sections,
  related,
}: LegalPageProps) {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 print:px-0 print:py-0">
        <div className="grid max-w-3xl gap-4">
          <p className="inline-flex items-center gap-2.5 text-sm font-semibold text-brand">
            <span aria-hidden="true" className="h-px w-6 bg-brand-gradient" />
            {eyebrow}
          </p>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-foreground sm:text-4xl rtl:leading-snug rtl:font-bold">
            {title}
          </h1>
          <p className="text-base text-muted sm:text-lg">{summary}</p>
          <p className="text-sm text-subtle">
            <time dateTime={updatedIso}>{updatedLabel}</time>
          </p>
        </div>
        {draft ? (
          <div className="mt-8">
            <DraftNotice title={draft.title} body={draft.body} />
          </div>
        ) : null}
        <div className="mt-10 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 print:block">
          <LegalToc label={tocLabel} items={sections} />
          <article className="grid max-w-3xl gap-12 print:mt-6">
            {sections.map(({ id, number, title: sectionTitle, children }) => (
              <section
                key={id}
                id={id}
                aria-labelledby={`${id}-title`}
                className="scroll-mt-24 border-t border-border pt-10 first:border-t-0 first:pt-0 print:break-inside-avoid-page"
              >
                <h2
                  id={`${id}-title`}
                  className="flex items-baseline gap-3 text-xl leading-snug font-semibold text-foreground sm:text-2xl rtl:font-bold"
                >
                  <span aria-hidden="true" className="text-brand tabular-nums">
                    {number}
                  </span>
                  {sectionTitle}
                </h2>
                <div className="mt-5 grid gap-4 text-base leading-7 text-foreground rtl:leading-8">
                  {children}
                </div>
              </section>
            ))}
          </article>
        </div>
        <nav aria-label={related.label} className="mt-16 border-t border-border pt-8 print:hidden">
          <p className="text-sm font-semibold text-foreground">{related.label}</p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {related.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={relatedLinkClass}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
