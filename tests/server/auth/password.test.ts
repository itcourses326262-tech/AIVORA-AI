import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SCRYPT_PARAMS,
  assertPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/server/auth/password';
import { COMMON_PASSWORDS } from '@/server/auth/common-passwords';
import { AppError } from '@/lib/errors';

/** A hash in the stored format made with explicit (possibly weak) parameters. */
function legacyHash(password: string, N: number, r = 8, p = 1): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

function policyIssue(password: string, context?: { email?: string }) {
  try {
    assertPasswordPolicy(password, context);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe('validation_failed');
    expect(appError.status).toBe(422);
    return (appError.details as { issues: Array<{ path: string; message: string }> }).issues;
  }
  return null;
}

describe('hashPassword / verifyPassword', () => {
  it('round-trips and writes the self-describing format', async () => {
    const hash = await hashPassword('s3cret-Passphrase!');
    const [format, n, r, p, salt, key] = hash.split('$');
    expect(format).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 15);
    expect([Number(n), Number(r), Number(p)]).toEqual([
      SCRYPT_PARAMS.N,
      SCRYPT_PARAMS.r,
      SCRYPT_PARAMS.p,
    ]);
    expect(Buffer.from(salt ?? '', 'base64url')).toHaveLength(SCRYPT_PARAMS.saltLength);
    expect(Buffer.from(key ?? '', 'base64url')).toHaveLength(SCRYPT_PARAMS.keyLength);
    expect(await verifyPassword('s3cret-Passphrase!', hash)).toBe(true);
  });

  it('rejects a wrong password, even a near miss', async () => {
    const hash = await hashPassword('s3cret-Passphrase!');
    expect(await verifyPassword('s3cret-Passphrase', hash)).toBe(false);
    expect(await verifyPassword('S3cret-Passphrase!', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts every hash, so equal passwords never share one', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password-1'),
      hashPassword('same-password-1'),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-1', a)).toBe(true);
    expect(await verifyPassword('same-password-1', b)).toBe(true);
  });

  it('treats visually identical Unicode as the same password (NFKC)', async () => {
    const hash = await hashPassword('ｐａｓｓｗｏｒｄ-ＡＢＣ-123'); // full-width Latin
    expect(await verifyPassword('password-ABC-123', hash)).toBe(true);
    const arabic = await hashPassword('كلمة-سر-قوية-١٢٣');
    expect(await verifyPassword('كلمة-سر-قوية-١٢٣', arabic)).toBe(true);
  });

  it('returns false for malformed or hostile hash strings instead of throwing', async () => {
    const valid = await hashPassword('another-password-9');
    const parts = valid.split('$');
    const malformed = [
      '',
      'not-a-hash',
      'not-a-real-hash',
      'bcrypt$2b$10$abcdefghijklmnopqrstuvwxyz',
      'scrypt$32768$8$2$salt',
      [...parts.slice(0, 1), '1000', ...parts.slice(2)].join('$'), // N below the floor
      [...parts.slice(0, 1), '40000', ...parts.slice(2)].join('$'), // N not a power of two
      [...parts.slice(0, 1), String(2 ** 30), ...parts.slice(2)].join('$'), // memory bomb
      [...parts.slice(0, 2), '9999', ...parts.slice(3)].join('$'), // absurd r
      [...parts.slice(0, 3), '0', ...parts.slice(4)].join('$'), // p = 0
      [...parts.slice(0, 4), 'AA', parts[5]].join('$'), // salt too short
      [...parts.slice(0, 5), 'AA'].join('$'), // hash too short
    ];
    for (const hash of malformed) {
      expect(await verifyPassword('another-password-9', hash), hash).toBe(false);
    }
  });

  it('refuses absurdly long input without hashing it', async () => {
    const hash = await hashPassword('another-password-9');
    expect(await verifyPassword('x'.repeat(5000), hash)).toBe(false);
  });

  it('verifies a hash made with other parameters, using the ones it states', async () => {
    const weak = legacyHash('legacy-password-1', 2 ** 14, 8, 1);
    expect(await verifyPassword('legacy-password-1', weak)).toBe(true);
    expect(await verifyPassword('legacy-password-2', weak)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('is false for hashes made with the current parameters', async () => {
    expect(needsRehash(await hashPassword('current-password-1'))).toBe(false);
  });

  it('is true for weaker parameters and for hashes it cannot read', () => {
    expect(needsRehash(legacyHash('pw-weaker-n', 2 ** 14, 8, 2))).toBe(true);
    expect(needsRehash(legacyHash('pw-weaker-r', 2 ** 15, 4, 2))).toBe(true);
    expect(needsRehash(legacyHash('pw-weaker-p', 2 ** 15, 8, 1))).toBe(true);
    expect(needsRehash('not-a-real-hash')).toBe(true);
    expect(needsRehash('')).toBe(true);
  });

  it('is false for stronger parameters', () => {
    expect(needsRehash(legacyHash('pw-stronger', 2 ** 16, 8, 2))).toBe(false);
  });
});

describe('assertPasswordPolicy', () => {
  it('accepts ordinary passwords of 8 to 128 characters', () => {
    expect(policyIssue('abcd-1234')).toBeNull();
    expect(policyIssue('كلمة مرور طويلة وآمنة')).toBeNull();
    expect(policyIssue('p'.repeat(PASSWORD_MIN_LENGTH - 1) + 'q')).toBeNull();
    expect(policyIssue('xyzw-'.repeat(25) + 'abc')).toBeNull(); // 128 characters
  });

  it('rejects short and overlong passwords with a field issue at "password"', () => {
    expect(policyIssue('short7!')).toEqual([
      { path: 'password', message: expect.stringContaining('at least 8') },
    ]);
    expect(policyIssue('a1'.repeat(PASSWORD_MAX_LENGTH))).toEqual([
      { path: 'password', message: expect.stringContaining('at most 128') },
    ]);
    expect(policyIssue('')).not.toBeNull();
  });

  it('counts characters, not UTF-16 units', () => {
    expect(policyIssue('😀'.repeat(8))).not.toBeNull(); // 8 emoji but "too simple": one repeated
    expect(policyIssue('😀😁😂🤣😃😄😅😆')).toBeNull(); // 8 characters, 16 units
    expect(policyIssue('😀😁😂🤣😃😄😅')).not.toBeNull(); // 7 characters
  });

  it('rejects common passwords whatever their case or width', () => {
    for (const password of [
      'password',
      'PASSWORD',
      'Password123',
      '12345678',
      'qwertyuiop',
      'ＰＡＳＳＷＯＲＤ',
    ]) {
      expect(policyIssue(password), password).toEqual([
        { path: 'password', message: 'Password is too common' },
      ]);
    }
  });

  it('rejects one repeated character and the account email', () => {
    expect(policyIssue('zzzzzzzzzz')).toEqual([
      { path: 'password', message: 'Password is too simple' },
    ]);
    expect(policyIssue('someone-long@example.com', { email: 'Someone-Long@example.com' })).toEqual([
      { path: 'password', message: expect.stringContaining('email') },
    ]);
    expect(policyIssue('someone-long', { email: 'someone-long@example.com' })).not.toBeNull();
    expect(
      policyIssue('someone-long-and-different', { email: 'someone-long@example.com' }),
    ).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(policyIssue(undefined as unknown as string)).not.toBeNull();
    expect(policyIssue(12345678 as unknown as string)).not.toBeNull();
  });

  it('keeps the deny list lower-case and long enough to matter', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(100);
    for (const entry of COMMON_PASSWORDS) expect(entry).toBe(entry.toLowerCase());
  });
});
