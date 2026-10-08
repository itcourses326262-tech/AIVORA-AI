// OWNER: auth-security — real, not a stub. The hash below is a storage contract: test factories
// (tests/helpers/factories.ts) insert session rows with it, so keep its output stable.
import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { getEnv } from '@/server/env';

/**
 * What the database stores for a session token or API key: the hex HMAC-SHA256 of the secret keyed
 * with the SESSION_SECRET pepper. The secret itself is never stored.
 */
export function hashToken(secret: string, pepper: string = getEnv().SESSION_SECRET): string {
  return createHmac('sha256', pepper).update(secret).digest('hex');
}

/** 32 random bytes as base64url (43 characters): the value of the `aivore_session` cookie. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}
