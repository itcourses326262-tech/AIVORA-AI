'use client';

import { useSyncExternalStore } from 'react';
import { Logo } from '@/components/ui/logo';
import {
  DEFAULT_LOCALE,
  createTranslator,
  dirOf,
  readLocaleCookie,
  resolveLocale,
  type Locale,
} from '@/lib/i18n';
import { DEFAULT_THEME, THEME_COOKIE, isTheme, type Theme } from '@/lib/theme';

/*
 * The last line of defence: it replaces the root layout, so nothing the layout provides exists
 * here (no providers, possibly no stylesheet, no cookies() on the server). It therefore renders
 * its own <html>, takes its language from the same cookie and browser preference as the rest of
 * the app but only in the browser (the server render uses the default, Arabic, which React then
 * reconciles without a mismatch), and styles itself with a small inline stylesheet and the system
 * font. The colours repeat the dark and light tokens of globals.css on purpose.
 */

const subscribe = () => () => {};

function readLocale(): Locale {
  return resolveLocale({
    cookie: readLocaleCookie(document.cookie),
    acceptLanguage: navigator.languages.join(','),
  });
}

function readTheme(): Theme {
  const match = document.cookie
    .split(';')
    .map((pair) => pair.trim().split('='))
    .find(([name]) => name === THEME_COOKIE);
  return isTheme(match?.[1]) ? match[1] : DEFAULT_THEME;
}

const STYLES = `
:root{color-scheme:dark;--bg:#0b0b16;--fg:#f4f4fa;--muted:#a8a8c0;--line:#2a2a45;--primary:#6d4aff;--brand-from:#8b6cff;--brand-to:#22d3ee;--danger:#fb7d7d}
:root[data-theme=light]{color-scheme:light;--bg:#f6f6fb;--fg:#14142b;--muted:#55556f;--line:#e2e2ee;--primary:#5b3df5;--brand-from:#6d4aff;--brand-to:#0b86a6;--danger:#b91c1c}
@media (prefers-color-scheme:light){:root[data-theme=system]{color-scheme:light;--bg:#f6f6fb;--fg:#14142b;--muted:#55556f;--line:#e2e2ee;--primary:#5b3df5;--brand-from:#6d4aff;--brand-to:#0b86a6;--danger:#b91c1c}}
:root[data-theme=system]{color-scheme:dark light}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Tahoma,'Noto Sans Arabic',Arial,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.ge-page{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px 20px;text-align:center;background:radial-gradient(42rem 22rem at 50% -6%,color-mix(in oklab,var(--brand-from) 26%,transparent),transparent 70%)}
.ge-logo{height:30px;color:var(--fg)}
.ge-card{max-width:30rem;display:grid;gap:14px;justify-items:center}
.ge-title{margin:0;font-size:clamp(1.75rem,5vw,2.5rem);line-height:1.25;font-weight:700}
.ge-text{margin:0;color:var(--muted);font-size:1.0625rem}
.ge-ref{margin:0;padding:2px 10px;border-radius:6px;background:color-mix(in oklab,var(--fg) 8%,transparent);color:var(--muted);font:0.75rem ui-monospace,SFMono-Regular,Menlo,monospace}
.ge-button{margin-top:8px;display:inline-flex;align-items:center;justify-content:center;height:48px;padding:0 28px;border:0;border-radius:12px;background:linear-gradient(var(--angle,120deg),#7048ff,#3b6cf0);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.ge-button:hover{filter:brightness(1.08)}
.ge-button:focus-visible{outline:2px solid var(--brand-from);outline-offset:3px}
:root[dir=rtl]{--angle:240deg}
`;

/**
 * Shown when the root layout itself fails. Reload is the one action that can help: whatever broke
 * is above anything a smaller reset could recover.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => DEFAULT_LOCALE);
  const theme = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME);
  const { t } = createTranslator(locale);
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme}>
      <head>
        <title>{t('landing.status.globalError.title')}</title>
        <style>{STYLES}</style>
      </head>
      <body>
        <main className="ge-page">
          <Logo label={null} className="ge-logo" />
          <div className="ge-card">
            <h1 className="ge-title">{t('landing.status.globalError.title')}</h1>
            <p className="ge-text">{t('landing.status.globalError.description')}</p>
            {error.digest ? (
              <p dir="auto" className="ge-ref">
                {t('landing.status.error.reference', { digest: error.digest })}
              </p>
            ) : null}
            <button type="button" className="ge-button" onClick={() => window.location.reload()}>
              {t('landing.status.globalError.reload')}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
