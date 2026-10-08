import { describe, expect, it } from 'vitest';
import { BUILT_IN_DISPOSABLE_DOMAINS, isDisposableEmail } from '@/server/auth/disposable-domains';

describe('isDisposableEmail', () => {
  it.each([
    'mailinator.com',
    'guerrillamail.com',
    'yopmail.com',
    '10minutemail.com',
    'trashmail.com',
  ])('refuses a well-known throwaway provider: %s', (domain) => {
    expect(isDisposableEmail(`someone@${domain}`)).toBe(true);
  });

  it('ignores case and surrounding space in the domain', () => {
    expect(isDisposableEmail('Someone@MAILINATOR.COM')).toBe(true);
    expect(isDisposableEmail('someone@mailinator.com ')).toBe(true);
  });

  it('refuses subdomains of a throwaway provider, but not look-alikes', () => {
    expect(isDisposableEmail('x@inbox.mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@mailinator.com.example.org')).toBe(false);
    expect(isDisposableEmail('x@notmailinator.com')).toBe(false);
    expect(isDisposableEmail('x@mailinator.example')).toBe(false);
  });

  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'example.com',
    'aivore.example',
    'company.sa',
    'stc.com.sa',
  ])('lets a mainstream or ordinary domain through: %s', (domain) => {
    expect(isDisposableEmail(`someone@${domain}`)).toBe(false);
  });

  it('adds the operator list', () => {
    expect(isDisposableEmail('x@throwaway.example')).toBe(false);
    expect(isDisposableEmail('x@throwaway.example', ['throwaway.example'])).toBe(true);
    expect(isDisposableEmail('x@a.throwaway.example', ['throwaway.example'])).toBe(true);
  });

  it('says no to something that is not an address', () => {
    expect(isDisposableEmail('mailinator.com')).toBe(false);
    expect(isDisposableEmail('')).toBe(false);
  });

  it('keeps the built-in list sorted-ish, lower case and free of mainstream providers', () => {
    for (const domain of BUILT_IN_DISPOSABLE_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
    for (const mainstream of [
      'gmail.com',
      'outlook.com',
      'yahoo.com',
      'icloud.com',
      'proton.me',
      'example.com',
    ]) {
      expect(BUILT_IN_DISPOSABLE_DOMAINS.has(mainstream)).toBe(false);
    }
    expect(BUILT_IN_DISPOSABLE_DOMAINS.size).toBeGreaterThan(100);
  });
});
