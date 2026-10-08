import 'server-only';
import { AppError } from '@/lib/errors';
import type { AuthContext } from '@/server/auth';
import { isValidIdempotencyKey } from '@/server/generations/idempotency';

/**
 * Money moves only from a signed-in browser session: an API key (which a script may hold, leak or
 * share) can neither start a purchase nor read the billing history.
 */
export function requireBrowserSession(auth: AuthContext): void {
  if (auth.via !== 'session') {
    throw AppError.of('forbidden', 'Billing is only available from a signed-in browser session');
  }
}

/** The mandatory `Idempotency-Key` of a checkout: it makes a double click or a retry harmless. */
export function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get('idempotency-key')?.trim();
  if (key === undefined || !isValidIdempotencyKey(key)) {
    throw new AppError('validation_failed', 422, 'Request validation failed', {
      issues: [
        {
          path: 'Idempotency-Key',
          message:
            key === undefined || key === ''
              ? 'Required'
              : 'Must be 1 to 128 visible ASCII characters without spaces',
        },
      ],
    });
  }
  return key;
}
