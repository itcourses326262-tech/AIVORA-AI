import { cleanEmailState } from '../email/support';
import { cleanSecurityState } from './support';

export { GOOD_PASSWORD, passwordFixture, stubEnv } from './support';
export { linkIn, mailTo, stubRelay } from '../email/support';

/**
 * Fresh rate-limit counters, an empty outbox and no inherited SMTP or email policy for every test
 * of the trust and safety layer (account recovery, confirmation, sign-up abuse, data rights).
 */
export function trustTestState(): void {
  cleanSecurityState();
  cleanEmailState();
}
