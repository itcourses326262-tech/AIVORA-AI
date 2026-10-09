import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocalTime } from '@/components/gallery/local-time';
import { useHydrated } from '@/components/gallery/use-hydrated';
import { I18nProvider } from '@/lib/i18n/client';

// Server rendering, as Next does it before the browser knows anything about its reader.
const TIME = Date.parse('2026-10-08T23:30:00Z');

describe('LocalTime on the server', () => {
  it('renders UTC, so the markup does not depend on the zone of the server', () => {
    const html = renderToString(
      <I18nProvider locale="en">
        <LocalTime timestamp={TIME} />
      </I18nProvider>,
    );
    expect(html).toContain('<time dateTime="2026-10-08T23:30:00.000Z">');
    expect(html).toContain('Oct 8, 2026, 11:30 PM');
  });

  it('uses the digits of the locale', () => {
    const html = renderToString(
      <I18nProvider locale="ar">
        <LocalTime timestamp={TIME} />
      </I18nProvider>,
    );
    expect(html).toMatch(/[٠-٩]/);
  });
});

describe('useHydrated on the server', () => {
  it('is false while the server renders', () => {
    function Probe() {
      return <span>{String(useHydrated())}</span>;
    }
    expect(renderToString(<Probe />)).toContain('false');
  });
});
