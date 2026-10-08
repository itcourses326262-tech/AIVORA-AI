'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useSyncExternalStore, useTransition } from 'react';
import { isLocale, serializeLocaleCookie, type Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { isTheme, serializeThemeCookie, type Theme } from '@/lib/theme';

const secure = () => window.location.protocol === 'https:';

/**
 * Switching the language writes the `aivore_locale` cookie and asks the server to render the page
 * again: `<html lang dir>` and every string follow, without a full reload.
 */
export function useLocaleSwitch(): {
  locale: Locale;
  pending: boolean;
  setLocale: (next: string) => void;
} {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const setLocale = useCallback(
    (next: string) => {
      if (!isLocale(next) || next === locale) return;
      document.cookie = serializeLocaleCookie(next, { secure: secure() });
      startTransition(() => router.refresh());
    },
    [locale, router],
  );
  return { locale, pending, setLocale };
}

const THEME_ATTRIBUTE = 'data-theme';

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function readTheme(): Theme {
  const value = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return isTheme(value) ? value : 'dark';
}

/**
 * The theme comes from the server as `<html data-theme>`. Switching writes the `aivore_theme`
 * cookie, applies the attribute at once (no waiting for the round trip) and refreshes so the
 * server's markup agrees.
 */
export function useThemeSwitch(): { theme: Theme; setTheme: (next: string) => void } {
  const router = useRouter();
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => 'dark' as const);
  const setTheme = useCallback(
    (next: string) => {
      if (!isTheme(next) || next === readTheme()) return;
      document.cookie = serializeThemeCookie(next, { secure: secure() });
      document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
      router.refresh();
    },
    [router],
  );
  return { theme, setTheme };
}
