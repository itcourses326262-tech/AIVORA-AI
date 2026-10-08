import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_COLORS,
  THEME_COOKIE,
  isTheme,
  serializeThemeCookie,
} from '@/lib/theme';

describe('theme', () => {
  it('defaults to dark and lists light, dark and system', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect([...THEMES]).toEqual(['light', 'dark', 'system']);
    expect(THEME_COOKIE).toBe('aivore_theme');
  });

  it('recognizes only known themes', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('system')).toBe(true);
    expect(isTheme('solarized')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(1)).toBe(false);
  });

  it('serializes a one-year, script-readable, lax cookie', () => {
    expect(serializeThemeCookie('light')).toBe(
      'aivore_theme=light; Path=/; Max-Age=31536000; SameSite=Lax',
    );
    expect(serializeThemeCookie('dark', { secure: true })).toMatch(/; Secure$/);
    expect(serializeThemeCookie('dark')).not.toMatch(/HttpOnly/i);
  });
});

describe('THEME_COLORS (the browser chrome color)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

  /** `--background` of the first rule whose selector contains `selector`. */
  function background(selector: string): string | undefined {
    const start = css.indexOf(selector);
    if (start < 0) return undefined;
    return /--background:\s*(#[0-9a-fA-F]{6})\s*;/.exec(css.slice(start))?.[1]?.toLowerCase();
  }

  it("equals each theme's --background token, so the chrome never clashes with the page", () => {
    expect(THEME_COLORS.dark).toBe(background(":root[data-theme='dark']"));
    expect(THEME_COLORS.light).toBe(background(":root[data-theme='light']"));
  });
});
