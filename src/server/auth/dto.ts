import 'server-only';
import type { UserDTO } from '@/lib/api-types';
import { getDb } from '@/server/db';
import type { UserRow } from '@/server/db/schema';
import type { SessionUser } from './context';
import { isEmailVerificationRequired } from './email-policy';
import { pendingSignupBonus } from './verification';

type VerificationFacts = Pick<
  UserDTO,
  'emailVerified' | 'emailVerificationRequired' | 'pendingBonusCredits'
>;

/**
 * Where the account stands with email confirmation, for the UI. The bonus is looked up only for an
 * account that has to confirm and has not: everybody else pays for no query.
 */
function verificationFacts(user: UserRow): VerificationFacts {
  const required = isEmailVerificationRequired();
  const verified = user.emailVerifiedAt !== null;
  return {
    emailVerified: verified,
    emailVerificationRequired: required,
    pendingBonusCredits: required && !verified ? pendingSignupBonus(getDb(), user) : 0,
  };
}

function identityOf(user: UserRow): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    creditBalance: user.creditBalance,
    hasPassword: user.hasPassword,
  };
}

/** What the server keeps about the signed-in user for the length of a request. */
export function toSessionUser(user: UserRow): SessionUser {
  return { ...identityOf(user), ...verificationFacts(user) };
}

/** The public shape of an account (`GET /auth/me`, `GET /account`). Never includes the hash. */
export function toUserDTO(user: UserRow): UserDTO {
  return {
    ...identityOf(user),
    hasPassword: user.hasPassword,
    createdAt: user.createdAt,
    ...verificationFacts(user),
  };
}
