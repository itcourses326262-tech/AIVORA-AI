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

// Letters and symbols that nevertheless draw nothing: the Hangul fillers (U+115F, U+1160, U+3164,
// U+FFA0) and the blank braille pattern (U+2800). Format characters (zero-width space, soft
// hyphen, joiners, marks) and spaces are not letters, numbers, punctuation or symbols, so they
// never count as visible either.
const BLANK_GLYPHS = /[\u115F\u1160\u2800\u3164\uFFA0]/gu;
const VISIBLE_CHARACTER = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Single-line text: NFC, inner whitespace collapsed, 1 to `max` characters, no hidden characters
 * and at least one character that is actually visible (a name made of zero-width spaces would
 * show as empty on the profile and the public gallery).
 */
export function parseLabel(raw: unknown, path: string, max: number): string {
  const text = typeof raw === 'string' ? raw.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
  const length = [...text].length;
  const visible = VISIBLE_CHARACTER.test(text.replace(BLANK_GLYPHS, ''));
  if (length < 1 || length > max || !visible || FORBIDDEN_TEXT.test(text)) {
    throw fieldError(path, `Must be 1 to ${max} printable characters`);
  }
  return text;
}

export function parseName(raw: unknown): string {
  return parseLabel(raw, 'name', NAME_MAX_LENGTH);
}
