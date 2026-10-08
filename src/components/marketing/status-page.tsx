import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Logo } from '@/components/ui/logo';
import { MeshBackdrop } from './mesh-backdrop';

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
      <MeshBackdrop />
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-6">
        <Link href="/" aria-label={homeLabel} className="rounded-lg text-foreground">
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
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">{actions}</div>
        </div>
      </main>
    </div>
  );
}
