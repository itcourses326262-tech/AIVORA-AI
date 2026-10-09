import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Logo } from '@/components/ui/logo';

/**
 * The soft light behind a status page: the landing page's mesh (blurred brand-coloured pools over a
 * faint grid), drawn with utilities instead of its CSS module. The root error and not-found
 * boundaries render this page, so everything they import is preloaded by every page of the app:
 * a CSS module here would be fetched and never used on all of them (and the browser says so in
 * the console).
 */
function StatusBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_62%,transparent)]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_55%_60%_at_50%_0%,#000,transparent_78%)] bg-size-[56px_56px] opacity-40" />
      <div className="absolute start-[calc(50%-38rem)] -top-80 size-176 rounded-full bg-[radial-gradient(circle,var(--brand-from),transparent_66%)] opacity-35 blur-[72px] dark:opacity-55" />
      <div className="absolute end-[calc(50%-36rem)] -top-56 size-144 rounded-full bg-[radial-gradient(circle,var(--brand-to),transparent_66%)] opacity-25 blur-[72px] dark:opacity-40" />
      <div className="absolute start-[calc(50%-16rem)] top-12 h-88 w-lg rounded-full bg-[radial-gradient(ellipse,var(--primary),transparent_70%)] opacity-20 blur-[72px] dark:opacity-35" />
    </div>
  );
}

/** Id of the heading, so a client error boundary can move focus to it. */
export const STATUS_TITLE_ID = 'status-title';

/** The camera frame of a status page: corner brackets, the brand spark knocked out of place, and what the page is about in the middle. */
function StatusMark({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="relative size-40 sm:size-48">
      <div className="absolute inset-4 rounded-[2rem] bg-brand-gradient opacity-25 blur-3xl" />
      <svg
        viewBox="0 0 160 160"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="absolute inset-0 size-full text-border-strong"
      >
        <path d="M24 56V36a12 12 0 0 1 12-12h20" />
        <path d="M104 24h20a12 12 0 0 1 12 12v20" />
        <path d="M136 104v20a12 12 0 0 1-12 12h-20" />
        <path d="M56 136H36a12 12 0 0 1-12-12v-20" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      <Logo
        variant="glyph"
        label={null}
        className="absolute -end-3 -top-3 size-14 drop-shadow-lg"
      />
    </div>
  );
}

export interface StatusPageProps {
  /** The text in the middle of the frame: an error number, or an icon. */
  mark: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  /** Accessible name of the logo link. */
  homeLabel: string;
  /** Something support can be told, such as an error digest. */
  reference?: string;
  /** Buttons or links that move the visitor on. */
  actions: ReactNode;
}

/**
 * The page a visitor lands on when something is missing or broken: the site is not available
 * around it (it may be what failed), so it brings its own minimal header. It works in server and
 * client trees alike: it has no state, only the language and theme switchers are client islands.
 */
export function StatusPage({
  mark,
  eyebrow,
  title,
  description,
  homeLabel,
  reference,
  actions,
}: StatusPageProps) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <StatusBackdrop />
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-6">
        <Link href="/" aria-label={homeLabel} className="hit-area rounded-lg text-foreground">
          <Logo label={null} className="h-7" />
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 pt-6 pb-24 outline-none"
      >
        <div className="flex max-w-xl flex-col items-center gap-5 text-center">
          <StatusMark>{mark}</StatusMark>
          <p className="text-sm font-semibold text-brand">{eyebrow}</p>
          <h1
            id={STATUS_TITLE_ID}
            tabIndex={-1}
            className="text-3xl leading-tight font-semibold tracking-tight text-foreground outline-none sm:text-4xl rtl:leading-snug rtl:font-bold"
          >
            {title}
          </h1>
          <p className="max-w-md text-base text-muted sm:text-lg">{description}</p>
          {reference ? (
            <p
              dir="auto"
              className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-xs text-muted"
            >
              {reference}
            </p>
          ) : null}
          <div className="mt-2 flex w-full max-w-xs flex-col items-stretch gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            {actions}
          </div>
        </div>
      </main>
    </div>
  );
}
