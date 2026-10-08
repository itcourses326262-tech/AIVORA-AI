import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useI18n } from '@/lib/i18n/client';

function Probe() {
  const { locale, dir, t, plural, setLocale } = useI18n();
  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="dir">{dir}</p>
      <p data-testid="text">{t('common.nav.studio')}</p>
      <p data-testid="plural">{plural(3, { one: '{count} item', other: '{count} items' })}</p>
      <button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>switch</button>
    </div>
  );
}

afterEach(() => {
  document.cookie = 'aivore_locale=; Max-Age=0; Path=/';
});

describe('I18nProvider / useI18n', () => {
  it('provides Arabic translations with rtl direction', () => {
    render(
      <I18nProvider locale="ar">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('ar');
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
    expect(screen.getByTestId('text')).toHaveTextContent('الاستوديو');
    expect(screen.getByTestId('plural')).toHaveTextContent('٣ items');
  });

  it('provides English translations with ltr direction', () => {
    render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('dir')).toHaveTextContent('ltr');
    expect(screen.getByTestId('text')).toHaveTextContent('Studio');
    expect(screen.getByTestId('plural')).toHaveTextContent('3 items');
  });

  it('re-renders when the locale prop changes', () => {
    const { rerender } = render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider locale="ar">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('text')).toHaveTextContent('الاستوديو');
  });

  it('setLocale stores the cookie and notifies the owner of the provider', async () => {
    const onLocaleChange = vi.fn();
    render(
      <I18nProvider locale="ar" onLocaleChange={onLocaleChange}>
        <Probe />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(document.cookie).toContain('aivore_locale=en');
    expect(onLocaleChange).toHaveBeenCalledExactlyOnceWith('en');
  });

  it('throws a clear error outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useI18n must be used inside <I18nProvider>');
    consoleError.mockRestore();
  });
});
