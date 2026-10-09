import 'server-only';
import { z } from 'zod';
import { LOCALES } from '@/lib/i18n/locales';
import { PASSWORD_MAX_LENGTH } from './password';

/*
 * Request bodies of the auth, account and key endpoints. They only gate type and size (so huge
 * inputs never reach scrypt or the database); the meaning (email syntax, password policy, name
 * rules) is checked by the services, which report field errors in the same shape.
 */

const locale = z.enum(LOCALES);

// UTF-16 units, not characters: the exact 128-character rule lives in `assertPasswordPolicy`.
const newPassword = z.string().max(PASSWORD_MAX_LENGTH * 2);

export const registerSchema = z.object({
  email: z.string().max(320),
  password: newPassword,
  name: z.string().max(400),
  locale: locale.optional(),
});

export const loginSchema = z.object({
  email: z.string().max(320),
  password: z.string().min(1).max(1024),
});

/**
 * The Firebase ID token is checked in full by the verifier, which also enforces its own length cap
 * (so an oversize token is the same 401 as any bad one); this only keeps absurd input out.
 */
export const firebaseLoginSchema = z.object({
  idToken: z
    .string()
    .min(1)
    .max(8 * 1024),
  locale: locale.optional(),
});

export const updateAccountSchema = z
  .object({ name: z.string().max(400).optional(), locale: locale.optional() })
  .refine((value) => value.name !== undefined || value.locale !== undefined, {
    message: 'Provide a name or a locale to update',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword,
});

export const createApiKeySchema = z.object({ name: z.string().max(400) });

/** A link secret is 43 characters; anything much longer is not one and never reaches the lookup. */
const linkToken = z.string().max(256);

export const confirmEmailSchema = z.object({ token: linkToken });
export const forgotPasswordSchema = z.object({ email: z.string().max(320) });
export const resetPasswordSchema = z.object({ token: linkToken, password: newPassword });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(1024) });

/** Small JSON bodies: nothing in these endpoints needs more. */
export const AUTH_BODY_LIMIT = 8 * 1024;
