import { afterEach, beforeEach, expect, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import {
  clearOutbox,
  flushEmails,
  lastOutboxMessage,
  setEmailTimingForTests,
  setEmailTransportOverride,
  type OutboxEntry,
} from '@/server/email';
import { outboxTransport } from '@/server/email/outbox';

/**
 * Every email test starts with an empty outbox, the default (outbox) transport and instant retries,
 * and waits for queued mail before it ends so nothing leaks into the next test.
 */
export function cleanEmailState(): void {
  beforeEach(() => {
    // A developer's shell may have SMTP or an email policy configured.
    for (const key of [
      'SMTP_URL',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_SECURE',
      'EMAIL_FROM',
      'EMAIL_VERIFICATION',
      'DISPOSABLE_EMAIL_DOMAINS',
      'SIGNUPS_PER_IP_PER_DAY',
    ]) {
      vi.stubEnv(key, '');
    }
    resetEnvForTests();
    clearOutbox();
    setEmailTransportOverride(null);
    setEmailTimingForTests({ retryDelayMs: 0, timeoutMs: 2_000 });
  });
  afterEach(async () => {
    await flushEmails();
    setEmailTransportOverride(null);
    setEmailTimingForTests(null);
    clearOutbox();
    vi.unstubAllEnvs();
    resetEnvForTests();
  });
}

export interface LinkInMail {
  url: URL;
  /** The `token` query parameter of the link. */
  token: string;
}

/** The action link of an outbox message (read from the plain-text body, like a person would). */
export function linkIn(message: OutboxEntry | undefined): LinkInMail {
  expect(message, 'an email in the outbox').toBeDefined();
  const match = /https?:\/\/\S+/.exec(message?.text ?? '');
  expect(match, 'a link in the plain-text body').not.toBeNull();
  const url = new URL(match?.[0] ?? '');
  return { url, token: url.searchParams.get('token') ?? '' };
}

/** Waits for queued mail and returns the newest message to `to`. */
export async function mailTo(to: string): Promise<OutboxEntry | undefined> {
  await flushEmails();
  return lastOutboxMessage(to);
}

/**
 * Stands in for the SMTP relay of a test that configures SMTP (so the policy sees "configured")
 * without any network: messages are recorded in the outbox, where the helpers above read them.
 */
export function stubRelay(): void {
  setEmailTransportOverride({ name: 'smtp', send: (message) => outboxTransport.send(message) });
}
