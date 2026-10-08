import { describe, expect, it } from 'vitest';
import {
  loginSchema,
  registerSchema,
  validate,
  validateField,
  validationMessage,
} from '@/components/auth/schemas';
import { createTranslator } from '@/lib/i18n';

const good = { name: 'Layla', email: 'layla@example.com', password: 'correct horse' };

describe('registerSchema', () => {
  it('accepts a valid account and trims name and email', () => {
    const result = validate(registerSchema, {
      name: '  Layla  ',
      email: '  layla@example.com ',
      password: 'correct horse',
    });
    expect(result).toEqual({ ok: true, data: good });
  });

  it('does not touch the password: spaces are part of it', () => {
    const result = validate(registerSchema, { ...good, password: '  spaced out  ' });
    expect(result).toMatchObject({ ok: true, data: { password: '  spaced out  ' } });
  });

  it.each([
    ['', 'emailRequired'],
    ['   ', 'emailRequired'],
    ['layla', 'emailInvalid'],
    ['layla@', 'emailInvalid'],
    ['@example.com', 'emailInvalid'],
    ['layla@example', 'emailInvalid'],
    ['la yla@example.com', 'emailInvalid'],
    [`${'a'.repeat(250)}@example.com`, 'emailInvalid'],
  ])('rejects the email %j as %s', (email, code) => {
    expect(validate(registerSchema, { ...good, email })).toEqual({
      ok: false,
      errors: { email: code },
    });
  });

  it.each([
    ['', 'passwordRequired'],
    ['1234567', 'passwordTooShort'],
    ['x'.repeat(129), 'passwordTooLong'],
  ])('rejects a password of %j characters as %s', (password, code) => {
    expect(validate(registerSchema, { ...good, password })).toEqual({
      ok: false,
      errors: { password: code },
    });
  });

  it('accepts the policy boundaries: 8 and 128 characters', () => {
    expect(validate(registerSchema, { ...good, password: 'x'.repeat(8) }).ok).toBe(true);
    expect(validate(registerSchema, { ...good, password: 'x'.repeat(128) }).ok).toBe(true);
  });

  it('requires a name of at most 80 characters', () => {
    expect(validate(registerSchema, { ...good, name: '  ' })).toMatchObject({
      errors: { name: 'nameRequired' },
    });
    expect(validate(registerSchema, { ...good, name: 'n'.repeat(81) })).toMatchObject({
      errors: { name: 'nameTooLong' },
    });
    expect(validate(registerSchema, { ...good, name: 'ليلى' }).ok).toBe(true);
  });

  it('reports the first problem of every field at once', () => {
    expect(validate(registerSchema, { name: '', email: 'x', password: '' })).toEqual({
      ok: false,
      errors: { name: 'nameRequired', email: 'emailInvalid', password: 'passwordRequired' },
    });
  });
});

describe('loginSchema', () => {
  it('only needs something to check: it neither reveals nor enforces the password policy', () => {
    expect(validate(loginSchema, { email: 'layla@example.com', password: 'x' }).ok).toBe(true);
    expect(validate(loginSchema, { email: 'layla@example.com', password: '' })).toMatchObject({
      errors: { password: 'passwordRequired' },
    });
  });
});

describe('validateField', () => {
  it('returns the problem of one field, or nothing', () => {
    expect(validateField(registerSchema, 'email', { ...good, email: 'nope' })).toBe('emailInvalid');
    expect(validateField(registerSchema, 'name', { ...good, email: 'nope' })).toBeUndefined();
  });
});

describe('validationMessage', () => {
  it('names a dictionary key, with the limit as a variable where the text has one', () => {
    expect(validationMessage('emailInvalid')).toEqual({
      key: 'auth.validation.emailInvalid',
      vars: undefined,
    });
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    const short = validationMessage('passwordTooShort');
    expect(en.t(short.key, short.vars)).toBe('Use at least 8 characters.');
    expect(ar.t(short.key, short.vars)).toBe('استخدم ٨ أحرف على الأقل.');
    const long = validationMessage('nameTooLong');
    expect(en.t(long.key, long.vars)).toBe('Use 80 characters or fewer.');
  });
});
