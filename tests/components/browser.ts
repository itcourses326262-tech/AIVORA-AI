import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import type axeCore from 'axe-core';
import postcss from 'postcss';
import type { Locale } from '@/lib/i18n/locales';
import { dirOf } from '@/lib/i18n/locales';

/**
 * Real-browser checks for what jsdom cannot see (layout, computed styles). The page is made of the
 * project's actual stylesheet (compiled by Tailwind, with the self-hosted fonts) around markup the
 * test renders with `renderToStaticMarkup`. Nothing touches the network or a running server; when
 * no Chromium is installed the suites that need it skip themselves.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GLOBALS = join(ROOT, 'src/app/globals.css');
const ORIGIN = 'http://aivore.test';
const PAGE_PATH = '/src/app/page.html'; // the stylesheet's relative font URLs resolve from here
const FONT_DIR = '/node_modules/@fontsource-variable/';

/** The pre-installed Chromium (same lookup as playwright.config.ts), or undefined when absent. */
export function chromiumPath(): string | undefined {
  const fromEnv = process.env.PW_CHROMIUM_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(browsers)) return undefined;
  const revisions = readdirSync(browsers)
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const match of revisions) {
    const candidate = join(browsers, match[0], 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

let stylesheet: Promise<string> | undefined;

/** The compiled `globals.css`, once per test file. */
function compiledStylesheet(): Promise<string> {
  stylesheet ??= postcss([tailwind()])
    .process(readFileSync(GLOBALS, 'utf8'), { from: GLOBALS })
    .then((result) => result.css);
  return stylesheet;
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath() });
}

export interface OpenPageOptions {
  locale: Locale;
  theme?: 'dark' | 'light';
  width: number;
  height?: number;
}

/** Opens `markup` inside `<body>` of a document that looks like the app's, at the given viewport. */
export async function openPage(
  browser: Browser,
  markup: string,
  { locale, theme = 'dark', width, height = 800 }: OpenPageOptions,
): Promise<Page> {
  const css = await compiledStylesheet();
  const html = `<!doctype html><html lang="${locale}" dir="${dirOf(locale)}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AIVORE</title><style>${css}</style></head><body class="min-h-dvh antialiased">${markup}</body></html>`;
  const context = await browser.newContext({ viewport: { width, height }, locale });
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === PAGE_PATH) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      return;
    }
    const file = join(ROOT, normalize(decodeURIComponent(pathname)));
    const servable = pathname.startsWith(FONT_DIR) && file.startsWith(ROOT + sep);
    if (servable && existsSync(file)) await route.fulfill({ path: file });
    else await route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}${PAGE_PATH}`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/**
 * Runs axe-core in the page (with real layout, so colour contrast and visibility count) and
 * returns one line per violation. Page-level rules are off: the harness page is a fragment.
 * `label-content-name-mismatch` is experimental in axe and switched on.
 */
export async function axeViolationsInPage(page: Page): Promise<string[]> {
  const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const { axe } = globalThis as unknown as { axe: typeof axeCore };
    const results = await axe.run(document, {
      rules: {
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
        'label-content-name-mismatch': { enabled: true },
      },
    });
    return results.violations.map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  });
}
