import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n/client';
import { dirOf, type Locale } from '@/lib/i18n/locales';

export interface RenderOptions {
  locale?: Locale;
}

/**
 * Renders inside the i18n provider and sets `<html lang dir>` like the root layout does, so
 * direction-aware components (`isRtl` reads the DOM) behave as they do in the app. `rerender`
 * keeps the provider around the new element.
 */
export function renderUi(ui: ReactElement, { locale = 'en' }: RenderOptions = {}): RenderResult {
  document.documentElement.lang = locale;
  document.documentElement.dir = dirOf(locale);
  const wrap = (element: ReactNode) => <I18nProvider locale={locale}>{element}</I18nProvider>;
  const result = render(wrap(ui));
  return { ...result, rerender: (next) => result.rerender(wrap(next)) };
}
