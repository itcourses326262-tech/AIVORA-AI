import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '@/server/auth/tokens';

describe('hashToken', () => {
  it('is a deterministic 64-character hex digest', () => {
    const hash = hashToken('secret', 'pepper');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('secret', 'pepper')).toBe(hash);
  });

  it('depends on both the secret and the pepper', () => {
    expect(hashToken('secret', 'pepper')).not.toBe(hashToken('other', 'pepper'));
    expect(hashToken('secret', 'pepper')).not.toBe(hashToken('secret', 'other'));
  });

  it('is the HMAC-SHA256 of the secret keyed with the pepper (the storage contract)', () => {
    // Known answer: HMAC-SHA256(key="key", msg="The quick brown fox jumps over the lazy dog").
    expect(hashToken('The quick brown fox jumps over the lazy dog', 'key')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('defaults the pepper to SESSION_SECRET', () => {
    expect(hashToken('secret')).toBe(hashToken('secret', process.env.SESSION_SECRET));
  });
});

describe('generateToken', () => {
  it('returns 32 random bytes as 43 base64url characters', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });
});
