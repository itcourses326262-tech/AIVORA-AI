import { describe, expect, it } from 'vitest';
import { canonicalizeEmail } from '@/server/auth/email-canonical';

describe('canonicalizeEmail', () => {
  it.each([
    ['ab@gmail.com', 'ab@gmail.com'],
    ['a.b@gmail.com', 'ab@gmail.com'],
    ['a.b.c@gmail.com', 'abc@gmail.com'],
    ['ab+promo@gmail.com', 'ab@gmail.com'],
    ['a.b+promo@gmail.com', 'ab@gmail.com'],
    ['a.b+x+y@gmail.com', 'ab@gmail.com'],
    ['A.B+Promo@GMAIL.COM', 'ab@gmail.com'],
    ['a.b@googlemail.com', 'ab@gmail.com'],
    ['  a.b@GoogleMail.com ', 'ab@gmail.com'],
  ])('folds the Gmail aliases %s -> %s', (input, expected) => {
    expect(canonicalizeEmail(input)).toBe(expected);
  });

  it.each([
    ['first.last@example.com', 'first.last@example.com'],
    ['first.last+tag@example.com', 'first.last@example.com'],
    ['name+a@outlook.com', 'name@outlook.com'],
    ['Name+A@Custom-Domain.ORG', 'name@custom-domain.org'],
  ])('keeps dots but drops +tags elsewhere: %s -> %s', (input, expected) => {
    expect(canonicalizeEmail(input)).toBe(expected);
  });

  it('does not let a tag swallow the whole name', () => {
    expect(canonicalizeEmail('+news@example.com')).toBe('+news@example.com');
  });

  it('keeps different mailboxes apart', () => {
    const a = canonicalizeEmail('alice@gmail.com');
    const b = canonicalizeEmail('alice2@gmail.com');
    const c = canonicalizeEmail('alice@example.com');
    expect(new Set([a, b, c]).size).toBe(3);
    // A dotted address on a provider where dots matter is a different mailbox.
    expect(canonicalizeEmail('a.lice@example.com')).not.toBe(
      canonicalizeEmail('alice@example.com'),
    );
  });

  it('is idempotent', () => {
    for (const input of ['A.B+c@Gmail.com', 'x+y@example.com', 'plain@example.com', 'no-at-sign']) {
      const once = canonicalizeEmail(input);
      expect(canonicalizeEmail(once)).toBe(once);
    }
  });

  it('passes through anything that is not an address, lower-cased', () => {
    expect(canonicalizeEmail('Not An Email')).toBe('not an email');
    expect(canonicalizeEmail('a@')).toBe('a@');
    expect(canonicalizeEmail('@gmail.com')).toBe('@gmail.com');
  });
});
