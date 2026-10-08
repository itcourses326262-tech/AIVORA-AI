import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';

export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 80;

/** `validation_failed` (422) with one issue, in the same shape the request validation produces. */
export function fieldError(path: string, message: string): AppError {
  return new AppError('validation_failed', 422, 'Request validation failed', {
    issues: [{ path, message }],
  });
}

const emailSchema = z.email().max(EMAIL_MAX_LENGTH);

/** Lower-cased, trimmed form used for storage and lookups. No validation. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** The normalized email, or a `validation_failed` error at path `email`. ASCII addresses only. */
export function parseEmail(raw: unknown): string {
  const email = normalizeEmail(raw);
  if (!emailSchema.safeParse(email).success)
    throw fieldError('email', 'Enter a valid email address');
  return email;
}

// Control, unassigned and private-use characters, plus the bidi overrides and isolates that can
// make a display name render as something else. Joiners and the LRM/RLM marks stay: Arabic and
// Persian text needs them.
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cs}\p{Co}\p{Cn}‪-‮⁦-⁩]/u;

/** Single-line text: NFC, inner whitespace collapsed, 1 to `max` characters, no hidden characters. */
export function parseLabel(raw: unknown, path: string, max: number): string {
  const text = typeof raw === 'string' ? raw.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
  const length = [...text].length;
  if (length < 1 || length > max || FORBIDDEN_TEXT.test(text)) {
    throw fieldError(path, `Must be 1 to ${max} printable characters`);
  }
  return text;
}

export function parseName(raw: unknown): string {
  return parseLabel(raw, 'name', NAME_MAX_LENGTH);
}
