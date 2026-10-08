import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TABS,
  accountHref,
  isAccountTab,
  parseAccountTab,
} from '@/components/account/tabs';

describe('account tabs', () => {
  it('has the five sections, in the order they are shown', () => {
    expect(ACCOUNT_TABS).toEqual(['profile', 'security', 'credits', 'keys', 'data']);
  });

  it('opens the section a link asks for', () => {
    for (const tab of ACCOUNT_TABS) expect(parseAccountTab(tab)).toBe(tab);
  });

  it('opens the profile for anything else', () => {
    for (const value of [undefined, '', 'billing', 'KEYS', '__proto__', 'keys ', 'constructor']) {
      expect(parseAccountTab(value), String(value)).toBe('profile');
    }
  });

  it('reads the first of a repeated parameter', () => {
    expect(parseAccountTab(['credits', 'keys'])).toBe('credits');
    expect(parseAccountTab(['nope', 'keys'])).toBe('profile');
    expect(parseAccountTab([])).toBe('profile');
  });

  it('tells a tab from any other value', () => {
    expect(isAccountTab('security')).toBe(true);
    expect(isAccountTab('billing')).toBe(false);
    expect(isAccountTab(undefined)).toBe(false);
    expect(isAccountTab(3)).toBe(false);
  });

  it('gives the profile the plain address and the others a tab parameter', () => {
    expect(accountHref('profile')).toBe('/account');
    expect(accountHref('keys')).toBe('/account?tab=keys');
    for (const tab of ACCOUNT_TABS)
      expect(
        parseAccountTab(
          new URL(accountHref(tab), 'https://x').searchParams.get('tab') ?? undefined,
        ),
      ).toBe(tab);
  });
});
