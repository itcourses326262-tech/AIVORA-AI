// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** scrypt hash in a self-describing string (algorithm parameters, salt and hash). */
export async function hashPassword(_password: string): Promise<string> {
  throw new NotImplementedError('auth.hashPassword');
}

/** Constant-time comparison against a {@link hashPassword} result. False for malformed hashes. */
export async function verifyPassword(_password: string, _hash: string): Promise<boolean> {
  throw new NotImplementedError('auth.verifyPassword');
}

/**
 * Password policy: 8-128 characters and not in the built-in list of common passwords.
 * Throws `validation_failed` (details: one issue at path `password`) when it is not met.
 */
export function assertPasswordPolicy(_password: string): void {
  throw new NotImplementedError('auth.assertPasswordPolicy');
}
