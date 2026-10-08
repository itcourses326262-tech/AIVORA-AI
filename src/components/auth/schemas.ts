import { z } from 'zod';
import type { MessageKey, MessageVars } from '@/lib/i18n';

/** Mirrors the server's password policy (docs/ARCHITECTURE.md section 6.2): 8 to 128 characters. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 80;
/** The longest address SMTP allows. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Every schema reports a code (a key under `auth.validation`), never display text: the form turns
 * the code into the active language, so the same schema serves both.
 */
export type ValidationCode =
  | 'nameRequired'
  | 'nameTooLong'
  | 'emailRequired'
  | 'emailInvalid'
  | 'passwordRequired'
  | 'passwordTooShort'
  | 'passwordTooLong';

const MESSAGE_VARS: Partial<Record<ValidationCode, MessageVars>> = {
  nameTooLong: { max: NAME_MAX_LENGTH },
  passwordTooShort: { min: PASSWORD_MIN_LENGTH },
  passwordTooLong: { max: PASSWORD_MAX_LENGTH },
};

export function validationMessage(code: ValidationCode): { key: MessageKey; vars?: MessageVars } {
  return { key: `auth.validation.${code}`, vars: MESSAGE_VARS[code] };
}

const email = z
  .string()
  .trim()
  .min(1, 'emailRequired' satisfies ValidationCode)
  .max(EMAIL_MAX_LENGTH, 'emailInvalid' satisfies ValidationCode)
  .pipe(z.email('emailInvalid' satisfies ValidationCode));

const name = z
  .string()
  .trim()
  .min(1, 'nameRequired' satisfies ValidationCode)
  .max(NAME_MAX_LENGTH, 'nameTooLong' satisfies ValidationCode);

export const loginSchema = z.object({
  email,
  // A login must not reveal (or enforce) the policy: it only needs something to check.
  password: z
    .string()
    .min(1, 'passwordRequired' satisfies ValidationCode)
    .max(PASSWORD_MAX_LENGTH, 'passwordTooLong' satisfies ValidationCode),
});

export const registerSchema = z.object({
  name,
  email,
  password: z
    .string()
    .min(1, 'passwordRequired' satisfies ValidationCode)
    .min(PASSWORD_MIN_LENGTH, 'passwordTooShort' satisfies ValidationCode)
    .max(PASSWORD_MAX_LENGTH, 'passwordTooLong' satisfies ValidationCode),
});

export type FieldName = 'name' | 'email' | 'password';
export type FieldErrors = Partial<Record<FieldName, ValidationCode>>;

const CODES: readonly ValidationCode[] = [
  'nameRequired',
  'nameTooLong',
  'emailRequired',
  'emailInvalid',
  'passwordRequired',
  'passwordTooShort',
  'passwordTooLong',
];

function isValidationCode(value: unknown): value is ValidationCode {
  return CODES.includes(value as ValidationCode);
}

/** Shown when a schema fails without one of our codes (a value of the wrong type, say). */
const FALLBACK: Record<FieldName, ValidationCode> = {
  name: 'nameRequired',
  email: 'emailInvalid',
  password: 'passwordRequired',
};

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** Validates form values; on failure returns the first problem of every field. */
export function validate<S extends z.ZodType>(
  schema: S,
  values: unknown,
): ValidationResult<z.output<S>> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === 'name' || field === 'email' || field === 'password') && !errors[field]) {
      errors[field] = isValidationCode(issue.message) ? issue.message : FALLBACK[field];
    }
  }
  return { ok: false, errors };
}

/** The problem with one field, for validating as the user types. */
export function validateField(
  schema: z.ZodType,
  field: FieldName,
  values: Record<string, string>,
): ValidationCode | undefined {
  const result = validate(schema, values);
  return result.ok ? undefined : result.errors[field];
}
