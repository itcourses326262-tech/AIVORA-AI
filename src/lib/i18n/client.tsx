'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, serializeLocaleCookie, type Locale, type Translator } from './index';

export interface I18nContextValue extends Translator {
  /**
   * Persists the choice in the locale cookie, then calls `onLocaleChange` (e.g. `router.refresh`)
   * or, without one, reloads the page so the server re-renders `<html lang dir>`.
   */
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  children: ReactNode;
}

export function I18nProvider({ locale, onLocaleChange, children }: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({
      ...createTranslator(locale),
      setLocale: (next) => {
        document.cookie = serializeLocaleCookie(next, {
          secure: window.location.protocol === 'https:',
        });
        if (onLocaleChange) onLocaleChange(next);
        else window.location.reload();
      },
    }),
    [locale, onLocaleChange],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
