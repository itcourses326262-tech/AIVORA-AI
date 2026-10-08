import { z } from 'zod';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type ValidationCode,
} from './schemas';

/** The forgot-password and reset-password forms. Codes, like the schemas in `./schemas`. */

export const forgotSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'emailRequired' satisfies ValidationCode)
    .max(EMAIL_MAX_LENGTH, 'emailInvalid' satisfies ValidationCode)
    .pipe(z.email('emailInvalid' satisfies ValidationCode)),
});

export const resetSchema = z.object({
  password: z
    .string()
    .min(1, 'passwordRequired' satisfies ValidationCode)
    .min(PASSWORD_MIN_LENGTH, 'passwordTooShort' satisfies ValidationCode)
    .max(PASSWORD_MAX_LENGTH, 'passwordTooLong' satisfies ValidationCode),
});
