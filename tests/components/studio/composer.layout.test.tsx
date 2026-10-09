import type { Browser, Page } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/components/studio/composer';
import { useStudio, type StudioController } from '@/components/studio/use-studio';
import type { ModelDTO } from '@/lib/api-types';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider } from '@/lib/user-context';
import { chromiumPath, launchBrowser, openPage } from '../browser';
import { DEMO_IMAGE, USER, modelDTO } from '../generations/support';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/studio',
}));

/**
 * The real composer on a real controller, with the models already loaded (a server render runs no
 * effects, so the form would otherwise never receive them).
 */
function Strip({ model, others }: { model: ModelDTO; others: ModelDTO[] }) {
  const studio = useStudio({});
  const toolModels = [model, ...others];
  const ready: StudioController = {
    ...studio,
    models: { status: 'ready', models: toolModels, reload: () => {} },
    form: { ...studio.form, model, toolModels, cost: 1 },
  };
  return <Composer studio={ready} onOpenSettings={() => {}} />;
}

function stripMarkup(locale: Locale, model: ModelDTO): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={USER}>
        <Strip model={model} others={[DEMO_IMAGE()]} />
      </UserProvider>
    </I18nProvider>,
  );
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const chip = Array.from(document.querySelectorAll('button')).find((button) =>
      /^(Model|النموذج):/.test(button.textContent ?? ''),
    );
    const box = chip?.getBoundingClientRect();
    // The price is the first fixed-width item after the name: it must never be the part that is cut.
    const price = chip?.querySelector<HTMLElement>('span.shrink-0.whitespace-nowrap');
    return {
      viewport,
      price: price
        ? {
            clipped: price.scrollWidth > price.clientWidth,
            right: price.getBoundingClientRect().right,
            width: price.getBoundingClientRect().width,
          }
        : null,
      hidden: chip ? getComputedStyle(chip).display === 'none' : true,
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      chip: box
        ? {
            left: box.left,
            right: box.right,
            height: box.height,
            spills: (chip?.scrollWidth ?? 0) > (chip?.clientWidth ?? 0),
          }
        : null,
    };
  });
}

// The longest chip there is: a long name and a price that needs a plural.
const LONGEST = () => modelDTO('fal-nano-banana-pro');

/** The strip pads its content by 12px on each side. */
const GUTTER = 12;

describe.skipIf(chromiumPath() === undefined)(
  'the model chip in the phone composer, in a browser',
  () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await launchBrowser();
    }, 60_000);

    afterAll(async () => {
      await browser?.close();
    });

    // A chip whose text is wider than the screen must be cut short ("…"), not widen the strip: the
    // strip is a grid, and a grid column grows to the widest thing in it unless it is pinned.
    it.each([
      ['en', 320],
      ['en', 360],
      ['en', 390],
      ['ar', 320],
      ['ar', 360],
      ['ar', 390],
    ] as const)(
      'stays inside the strip on one line, however long its text (%s, %ipx)',
      async (locale, width) => {
        const page = await openPage(browser, stripMarkup(locale, LONGEST()), {
          locale,
          width,
          touch: true,
        });
        const measured = await overflow(page);
        await page.context().close();

        const chip = measured.chip;
        expect(chip).not.toBeNull();
        expect(chip?.left).toBeGreaterThanOrEqual(0);
        expect(chip?.right).toBeLessThanOrEqual(measured.viewport);
        expect((chip?.right ?? 0) - (chip?.left ?? 0)).toBeLessThanOrEqual(
          measured.viewport - 2 * GUTTER + 1,
        );
        // A tap target of 40px with one line of text: no wrapping into a taller block.
        expect(chip?.height).toBeLessThan(48);
        // The name gives way ("…") instead of running out of the button.
        expect(chip?.spills).toBe(false);
        // The price is never the part that is cut: it keeps its full width inside the chip.
        expect(measured.price).not.toBeNull();
        expect(measured.price?.clipped).toBe(false);
        expect(measured.price?.width).toBeGreaterThan(20);
        expect(measured.price?.right).toBeLessThanOrEqual(chip?.right ?? 0);
      },
      60_000,
    );

    // The tap target meets the coarse-pointer minimum of 44px that the other controls use.
    it('is a 44px tap target on a touch screen', async () => {
      const page = await openPage(browser, stripMarkup('en', LONGEST()), {
        locale: 'en',
        width: 390,
        touch: true,
      });
      const measured = await overflow(page);
      await page.context().close();
      expect(measured.chip?.height).toBeGreaterThanOrEqual(44);
    }, 60_000);

    // On a phone held sideways the strip would leave no room for the results: the chip steps aside
    // and the model stays one tap away in Settings.
    it('is left out when the screen is only a few hundred pixels tall', async () => {
      const page = await openPage(browser, stripMarkup('en', LONGEST()), {
        locale: 'en',
        width: 844,
        height: 390,
        touch: true,
      });
      const measured = await overflow(page);
      await page.context().close();
      expect(measured.hidden).toBe(true);
    }, 60_000);

    // The Settings button gives up its word on narrow phones, so the whole row (Settings, Generate and
    // the chip above them) fits from 320px up.
    it.each([
      ['en', 320],
      ['en', 360],
      ['en', 390],
      ['ar', 320],
      ['ar', 360],
      ['ar', 390],
    ] as const)(
      'does not make the page wider than the screen (%s, %ipx)',
      async (locale, width) => {
        const page = await openPage(browser, stripMarkup(locale, LONGEST()), {
          locale,
          width,
          touch: true,
        });
        const measured = await overflow(page);
        await page.context().close();
        expect(measured.page).toBeLessThanOrEqual(measured.viewport);
      },
      60_000,
    );
  },
);
