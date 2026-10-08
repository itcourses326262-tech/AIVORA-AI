import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(),
}));

import { AuthAside } from '@/components/auth/auth-aside';

const render = async (bonus: number, locale: 'ar' | 'en' = 'en') => {
  mocks.cookies.set('aivore_locale', locale);
  return renderToStaticMarkup(await AuthAside({ bonus }));
};

const items = (html: string) =>
  [...html.matchAll(/<li [^>]*>.*?<\/span>(.*?)<\/li>/g)].map((match) => match[1]);

beforeEach(() => {
  mocks.cookies.clear();
});

describe('AuthAside', () => {
  it('lists what an account is for next to the form, with the real number of credits', async () => {
    const html = await render(50);
    expect(html).toContain('Everything you imagine, ready in seconds');
    expect(items(html)).toEqual([
      '50 credits free to start',
      'Prompts in Arabic or English',
      'Images and video in one studio',
      'A prompt enhancer that speaks Arabic',
    ]);
    expect(html).toMatch(/<aside [^>]*aria-labelledby="auth-panel-title"/);
    expect(html.match(/<h2 [^>]*id="auth-panel-title"/g)).toHaveLength(1);
  });

  it('leaves the credits out when a sign-up gives none', async () => {
    const list = items(await render(0));
    expect(list).toHaveLength(3);
    expect(list.join(' ')).not.toMatch(/credit/);
  });

  it('shows on wide screens only, where the register form drops its own shorter list', async () => {
    const html = await render(50);
    expect(html).toMatch(/<aside [^>]*class="[^"]*\bhidden\b[^"]*\bxl:grid\b/);
    expect(html).toMatch(/<figure [^>]*class="[^"]*\bhidden\b[^"]*\bxl:block\b/);
  });

  it('hides the sample artwork from assistive technology: it is decoration', async () => {
    const html = await render(50);
    expect(html).toMatch(/<figure [^>]*aria-hidden="true"/);
  });

  it('is Arabic when the page is, with Arabic grammar for the credits', async () => {
    const html = await render(50, 'ar');
    expect(html).toContain('كل ما تتخيله، جاهز خلال ثوانٍ');
    expect(items(html)[0]).toBe('٥٠ رصيدًا مجانًا للبدء');
    expect(items(html)[3]).toBe('محسّن وصف يفهم العربية');
  });

  it('places itself by logical offsets, so it mirrors with the language', async () => {
    const html = await render(50);
    expect(html).toContain('end-[calc(100%+4.5rem)]');
    expect(html).toContain('start-[calc(100%+4.5rem)]');
  });
});
