// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';

/** Throws `forbidden` when a cookie-authenticated mutating request comes from another origin. */
export function assertSameOrigin(_req: Request): void {
  throw new NotImplementedError('security.origin');
}
