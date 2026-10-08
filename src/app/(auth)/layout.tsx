import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Logo } from '@/components/ui/logo';
import { Toaster } from '@/components/ui/toast';
import { getI18n } from '@/lib/i18n/server';

export const metadata: Metadata = { robots: { index: false } };

/**
 * Log in and register: a centered card on the branded backdrop. The layout renders the page's one
 * `<main id="main-content">`; the pages inside only provide the card's content.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-aurora">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-dots opacity-70" />
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-6">
        <Link
          href="/"
          aria-label={t('common.a11y.home')}
          className="hit-area rounded-lg text-foreground"
        >
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
        className="flex flex-1 items-center justify-center px-4 pb-16 outline-none"
      >
        <div className="w-full max-w-md animate-slide-up rounded-3xl border border-border bg-surface/85 p-6 shadow-lg backdrop-blur-xl sm:p-8">
          {children}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
