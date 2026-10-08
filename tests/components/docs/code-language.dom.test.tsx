import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodeLanguageProvider,
  LanguageCode,
  LanguagePicker,
  type LanguageSample,
} from '@/components/docs/code-language';
import { CODE_LANGUAGE_COOKIE, type QuickstartLanguage } from '@/components/docs/snippets';
import { highlight } from '@/components/docs/tokenize';
import { Toaster } from '@/components/ui/toast';
import { axeViolations } from '../axe';
import { renderUi } from '../render';

const LABELS = { copy: 'Copy', copied: 'Copied', copyFailed: 'Could not copy' };

function samples(prefix: string): Record<QuickstartLanguage, LanguageSample> {
  const make = (language: 'bash' | 'javascript' | 'python', text: string): LanguageSample => ({
    lines: highlight(text, language),
    text,
  });
  return {
    bash: make('bash', `curl "${prefix}"`),
    javascript: make('javascript', `await fetch("${prefix}");`),
    python: make('python', `requests.get("${prefix}")`),
  };
}

function Page({ initial = 'bash' as QuickstartLanguage }) {
  return (
    <CodeLanguageProvider initial={initial}>
      <LanguagePicker label="Code language" />
      <LanguageCode samples={samples('one')} scope="First" labels={LABELS} />
      <LanguageCode samples={samples('two')} scope="Second" labels={LABELS} />
      <Toaster />
    </CodeLanguageProvider>
  );
}

const picker = () => screen.getByRole('radiogroup', { name: 'Code language' });
const regions = () => screen.getAllByRole('region');

function clearCookie() {
  document.cookie = `${CODE_LANGUAGE_COOKIE}=; Max-Age=0; Path=/`;
}
beforeEach(clearCookie);
afterEach(() => {
  clearCookie();
  vi.unstubAllGlobals();
});

describe('the code language switcher', () => {
  it('starts in the language it is given', () => {
    renderUi(<Page initial="python" />);
    expect(within(picker()).getByRole('radio', { name: 'Python' })).toBeChecked();
    expect(regions().map((region) => region.getAttribute('aria-label'))).toEqual([
      'First · Python (requests)',
      'Second · Python (requests)',
    ]);
    expect(regions()[0]).toHaveTextContent('requests.get("one")');
  });

  it('switches every example at once', async () => {
    const user = userEvent.setup();
    renderUi(<Page />);
    expect(regions()[1]).toHaveTextContent('curl "two"');
    await user.click(within(picker()).getByRole('radio', { name: 'JavaScript' }));
    expect(regions().map((region) => region.textContent)).toEqual([
      'await fetch("one");',
      'await fetch("two");',
    ]);
    expect(regions()[0]).toHaveAttribute('aria-label', 'First · JavaScript (fetch)');
  });

  it('remembers the choice in a cookie for a year', async () => {
    const user = userEvent.setup();
    renderUi(<Page />);
    await user.click(within(picker()).getByRole('radio', { name: 'Python' }));
    expect(document.cookie).toContain(`${CODE_LANGUAGE_COOKIE}=python`);
  });

  it('works with the arrow keys, following the reading direction', async () => {
    const user = userEvent.setup();
    renderUi(<Page />, { locale: 'ar' });
    within(picker()).getByRole('radio', { name: 'cURL' }).focus();
    await user.keyboard('{ArrowLeft}');
    // In right-to-left, the left arrow goes to the next option.
    expect(within(picker()).getByRole('radio', { name: 'JavaScript' })).toBeChecked();
  });

  it('keeps every snippet left to right inside an Arabic page', () => {
    const { container } = renderUi(<Page />, { locale: 'ar' });
    const window = container.querySelector('pre')?.closest('[dir]');
    expect(window).toHaveAttribute('dir', 'ltr');
    expect(container.querySelector('pre')).toHaveAttribute('lang', 'en');
  });

  it('copies exactly the text that is shown, and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderUi(<Page initial="javascript" />);
    await user.click(screen.getAllByRole('button', { name: 'Copy' })[1] as HTMLElement);
    expect(writeText).toHaveBeenCalledWith('await fetch("two");');
    await waitFor(() => expect(screen.getAllByText('Copied').length).toBeGreaterThan(0));
  });

  it('says when it cannot copy', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderUi(<Page />);
    await user.click(screen.getAllByRole('button', { name: 'Copy' })[0] as HTMLElement);
    expect(await screen.findByText('Could not copy')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderUi(<Page />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('refuses to be used without its provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderUi(<LanguagePicker label="x" />)).toThrow(/CodeLanguageProvider/);
    error.mockRestore();
  });
});
