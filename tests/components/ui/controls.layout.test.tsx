import type { Browser } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Checkbox } from '@/components/ui/checkbox';
import { Kbd } from '@/components/ui/kbd';
import { SegmentedControl } from '@/components/ui/radio-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { I18nProvider } from '@/lib/i18n/client';
import { chromiumPath, launchBrowser, openPage } from '../browser';
import { contrast, parseColor } from '../contrast';

const markup = renderToStaticMarkup(
  <I18nProvider locale="en">
    <main className="grid gap-4 p-6">
      <Checkbox label="Remember me" defaultChecked />
      <p>
        <Kbd>Ctrl</Kbd>
      </p>
      <SegmentedControl
        aria-label="Kind"
        value="image"
        options={[
          { value: 'image', label: 'Image' },
          { value: 'video', label: 'Video' },
        ]}
      />
      <Tabs defaultValue="all" appearance="pills">
        <TabsList aria-label="Filter">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="mine">Mine</TabsTrigger>
        </TabsList>
      </Tabs>
    </main>
  </I18nProvider>,
);

interface Measures {
  checkbox: { side: number; radius: number };
  kbd: { height: number; radius: number };
  segment: { boxShadow: string; container: string };
  pill: { boxShadow: string; container: string };
}

/** Runs inside the page, so it must not use anything from this module. */
function measure(): Measures {
  const style = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return { element, css: getComputedStyle(element) };
  };
  const checkbox = style('input[type="checkbox"]');
  const kbd = style('kbd');
  const segment = style('[role="radio"][aria-checked="true"]');
  const pill = style('[role="tab"][aria-selected="true"]');
  return {
    checkbox: {
      side: checkbox.element.getBoundingClientRect().width,
      radius: parseFloat(checkbox.css.borderTopLeftRadius),
    },
    kbd: {
      height: kbd.element.getBoundingClientRect().height,
      radius: parseFloat(kbd.css.borderTopLeftRadius),
    },
    segment: {
      boxShadow: segment.css.boxShadow,
      container: getComputedStyle(segment.element.parentElement as HTMLElement).backgroundColor,
    },
    pill: {
      boxShadow: pill.css.boxShadow,
      container: getComputedStyle(pill.element.parentElement as HTMLElement).backgroundColor,
    },
  };
}

/** The colour of the 1px ring (`0 0 0 1px <colour>`) in a computed `box-shadow`. */
function ringColor(boxShadow: string): string {
  const ring = /(rgba?\([^)]+\))\s+0px\s+0px\s+0px\s+1px/.exec(boxShadow);
  if (!ring) throw new Error(`no 1px ring in: ${boxShadow}`);
  return ring[1]!;
}

describe.skipIf(chromiumPath() === undefined)(
  'form and selection controls in a real browser',
  () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await launchBrowser();
    }, 60_000);

    afterAll(async () => {
      await browser?.close();
    });

    it.each(['dark', 'light'] as const)(
      'draws a checkbox as a box and a key cap as a key, not as circles: %s',
      async (theme) => {
        const page = await openPage(browser, markup, { locale: 'en', theme, width: 480 });
        const { checkbox, kbd } = await page.evaluate(measure);
        await page.context().close();
        expect(checkbox.side).toBe(20);
        expect(checkbox.radius).toBeGreaterThan(0);
        expect(checkbox.radius).toBeLessThanOrEqual(checkbox.side * 0.4); // 50% would be a radio
        expect(kbd.radius).toBeGreaterThan(0);
        expect(kbd.radius).toBeLessThanOrEqual(kbd.height * 0.4); // not a pill
      },
      60_000,
    );

    it.each(['dark', 'light'] as const)(
      'gives the selected segment and the selected pill an edge with 3:1 contrast: %s',
      async (theme) => {
        const page = await openPage(browser, markup, { locale: 'en', theme, width: 480 });
        const { segment, pill } = await page.evaluate(measure);
        await page.context().close();
        for (const { boxShadow, container } of [segment, pill]) {
          expect(
            contrast(parseColor(ringColor(boxShadow)), parseColor(container)),
          ).toBeGreaterThanOrEqual(3);
        }
      },
      60_000,
    );
  },
);
