import { randomBytes } from 'node:crypto';

/** Meets the password policy (length, not a common password) and is reused by every test user. */
export const TEST_PASSWORD = 'Str0ng-pass-92!';

export interface TestAccount {
  id: string;
  /** The whole name; only `firstName` may ever appear on a public page. */
  name: string;
  firstName: string;
  surname: string;
  email: string;
  password: string;
}

/** Short random token that makes names and addresses unique across tests, workers and runs. */
export function uniqueTag(): string {
  return randomBytes(5).toString('hex');
}

export function newAccountDetails(): Omit<TestAccount, 'id'> {
  const tag = uniqueTag();
  const firstName = 'Layla';
  const surname = `Hassan${tag}`;
  return {
    name: `${firstName} ${surname}`,
    firstName,
    surname,
    email: `e2e-${tag}@example.com`,
    password: TEST_PASSWORD,
  };
}

/**
 * A prompt no other test uses, so a test can find its own creation in a feed that every test
 * (running in parallel against one server) publishes to.
 */
export function uniquePrompt(subject: string): string {
  return `${subject} ${uniqueTag()}`;
}
