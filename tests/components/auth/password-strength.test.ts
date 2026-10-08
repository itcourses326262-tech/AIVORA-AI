import { describe, expect, it } from 'vitest';
import { scorePassword, type StrengthLevel } from '@/components/auth/password-strength';

const level = (password: string, email?: string): StrengthLevel =>
  scorePassword(password, email).level;

describe('scorePassword', () => {
  it('has nothing to say about an empty field', () => {
    expect(scorePassword('')).toEqual({ level: 'empty', score: 0 });
  });

  it('calls anything under the minimum length weak, however varied', () => {
    expect(level('a')).toBe('weak');
    expect(level('Aa1!xyz')).toBe('weak');
  });

  it.each([
    ['password', 'weak'],
    ['password123!', 'weak'],
    ['12345678', 'weak'],
    ['aaaaaaaaaaaaaaaa', 'weak'],
    ['abcdefgh1234', 'weak'],
    ['qwertyuiop', 'weak'],
    ['sunnyafternoon', 'fair'],
    ['Tr0ub4dor&3', 'good'],
    ['Sunny-afternoon-in-Cairo-7!', 'strong'],
  ] satisfies Array<[string, StrengthLevel]>)('rates %j as %s', (password, expected) => {
    expect(level(password)).toBe(expected);
  });

  it('lights more segments as the level rises', () => {
    const scores = ['password', 'sunnyafternoon', 'Tr0ub4dor&3', 'Sunny-afternoon-in-Cairo-7!'].map(
      (password) => scorePassword(password).score,
    );
    expect(scores).toEqual([1, 2, 3, 4]);
  });

  it('counts letters of any script: an Arabic passphrase is a passphrase', () => {
    expect(level('مرحبا بالعالم الجميل')).toBe('good');
    expect(level('مرحبا-بالعالم-الجميل-٢٠٢٦')).toBe('strong');
  });

  it('penalises a password built from the email address', () => {
    expect(level('layla.hassan2026', 'layla.hassan@example.com')).toBe('weak');
    expect(level('layla.hassan2026', 'someone.else@example.com')).not.toBe('weak');
  });
});
