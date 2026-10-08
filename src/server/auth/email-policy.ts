import 'server-only';
import { getEnv, type Env } from '@/server/env';
import { isSmtpConfigured } from '@/server/email';

/**
 * Whether an account must confirm its email address before it may create generations (and before
 * it receives the sign-up bonus). `EMAIL_VERIFICATION=auto` (the default) ties it to SMTP: with a
 * relay configured the confirmation email can actually be delivered, without one a fresh checkout
 * would lock every new user out of the studio.
 *
 * | EMAIL_VERIFICATION | SMTP configured | required |
 * | ------------------ | --------------- | -------- |
 * | auto               | yes             | yes      |
 * | auto               | no              | no       |
 * | required           | any             | yes      |
 * | off                | any             | no       |
 */
export function isEmailVerificationRequired(
  env: Pick<Env, 'EMAIL_VERIFICATION' | 'SMTP_URL' | 'SMTP_HOST'> = getEnv(),
): boolean {
  switch (env.EMAIL_VERIFICATION) {
    case 'required':
      return true;
    case 'off':
      return false;
    case 'auto':
      return isSmtpConfigured(env);
  }
}
