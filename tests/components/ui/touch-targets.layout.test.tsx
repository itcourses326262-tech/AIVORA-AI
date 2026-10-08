import type { Browser, Page } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { I18nProvider } from '@/lib/i18n/client';
import { chromiumPath, launchBrowser, openPage } from '../browser';

const markup = renderToStaticMarkup(
  <I18nProvider locale="en">
    <main className="grid justify-items-start gap-6 p-6">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <IconButton label="Small icon" size="sm" tooltip={false}>
        <span />
      </IconButton>
      <IconButton label="Medium icon" tooltip={false}>
        <span />
      </IconButton>
      <Input aria-label="Text" size="md" />
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
      <Switch aria-label="Public" />
      <Checkbox label="Remember me" />
    </main>
  </I18nProvider>,
);

/** Runs inside the page: the pressable height of every control, and of the switch's hit layer. */
function measure() {
  const height = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return element.getBoundingClientRect().height;
  };
  const named = (label: string) => `[aria-label="${label}"]`;
  const switchElement = document.querySelector<HTMLElement>('[role="switch"]');
  if (!switchElement) throw new Error('missing switch');
  const box = switchElement.getBoundingClientRect();
  // A point 9px above the visible track: it only reaches the switch through the invisible layer.
  const above = document.elementFromPoint(box.x + box.width / 2, box.y - 9);
  const label = document.querySelector<HTMLElement>('label');
  return {
    buttons: {
      sm: height('button:not([aria-label])'),
      md: [
        ...document.querySelectorAll<HTMLElement>('button:not([aria-label])'),
      ][1]!.getBoundingClientRect().height,
      lg: [
        ...document.querySelectorAll<HTMLElement>('button:not([aria-label])'),
      ][2]!.getBoundingClientRect().height,
    },
    iconSm: height(named('Small icon')),
    iconMd: height(named('Medium icon')),
    // The visible box around the field, not the bare <input> inside it.
    input: (
      document.querySelector<HTMLElement>('input[aria-label="Text"]')?.parentElement as HTMLElement
    ).getBoundingClientRect().height,
    segment: height('[role="radio"]'),
    pill: height('[role="tab"]'),
    switchTrack: box.height,
    switchHitLayer: above === switchElement,
    labelHeight: label ? label.getBoundingClientRect().height : 0,
  };
}

async function measureAt(browser: Browser, touch: boolean) {
  const page: Page = await openPage(browser, markup, { locale: 'en', width: 390, touch });
  const result = await page.evaluate(measure);
  await page.context().close();
  return result;
}

describe.skipIf(chromiumPath() === undefined)('touch targets in a real browser', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('makes every control at least 44px tall on a touch screen', async () => {
    const m = await measureAt(browser, true);
    for (const size of [
      m.buttons.sm,
      m.buttons.md,
      m.buttons.lg,
      m.iconSm,
      m.iconMd,
      m.input,
      m.segment,
      m.pill,
    ]) {
      expect(size).toBeGreaterThanOrEqual(44);
    }
    expect(m.labelHeight).toBeGreaterThanOrEqual(44);
  }, 60_000);

  it('reaches a 24px switch through an invisible 44px layer, without making it bigger', async () => {
    const m = await measureAt(browser, true);
    expect(m.switchTrack).toBe(24);
    expect(m.switchHitLayer).toBe(true);
  }, 60_000);

  it('keeps the compact sizes for a mouse', async () => {
    const m = await measureAt(browser, false);
    expect(m.buttons).toEqual({ sm: 32, md: 40, lg: 48 });
    expect(m.iconSm).toBe(32);
    expect(m.iconMd).toBe(40);
    expect(m.input).toBe(40);
    expect(m.switchHitLayer).toBe(false);
  }, 60_000);
});
