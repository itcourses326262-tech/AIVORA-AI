// OWNER: auth-security — replace this stub
import 'server-only';

/**
 * Client IP for rate limiting and logs. Stub behaviour: never trusts `X-Forwarded-For`, so every
 * caller shares the `unknown` bucket. The real version honours it only when TRUST_PROXY=true.
 */
export function getClientIp(_req: Request): string {
  return 'unknown';
}
