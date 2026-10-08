import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, THEME_COOKIE, isTheme, serializeThemeCookie } from '@/lib/theme';

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
