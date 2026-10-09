import 'server-only';
import { getLogger } from '@/server/logger';
import { recordFailedDelivery } from './outbox';
import { emailFrom, getEmailTransport } from './transport';
import { BILLING_EMAIL_KINDS, maskEmail, type EmailKind, type EmailMessage } from './types';

/**
 * Delivery with a deadline and one retry. Requests never wait for it: routes call
 * {@link queueEmail}, which hands the message to the event loop and returns. A message that cannot
 * be delivered is never dropped silently: it is logged at error level and a metadata-only record
 * lands in the outbox file (the body holds a working link, and a secret has no business in a file
 * because a relay was down). Passwords and tokens are never logged.
 *
 * The retry never repeats a BILLING message whose attempt ended at our own deadline: the deadline
 * only stops waiting, the relay may still accept that attempt (greylisting, a slow TLS or DATA
 * phase), and a second copy of a receipt or a renewal link would be a duplicate the dedupe record
 * of `server/billing/mail.ts` cannot see. Such a message is reported as failed with an unknown
 * outcome. Verification and reset links are repeated: a second copy is harmless, a lost link costs
 * the person a manual resend. A failure the transport itself reports (connection refused, a server
 * answer) is retried for every kind.
 */

export interface DeliveryTiming {
  /** Longest one attempt may take. */
  timeoutMs: number;
  /** Pause before the second (and last) attempt. */
  retryDelayMs: number;
}

const DEFAULT_TIMING: DeliveryTiming = { timeoutMs: 25_000, retryDelayMs: 2_000 };
let timing: DeliveryTiming = DEFAULT_TIMING;

/** Tests shorten the deadline and the pause; `null` restores the defaults. */
export function setEmailTimingForTests(next: Partial<DeliveryTiming> | null): void {
  timing = next ? { ...DEFAULT_TIMING, ...next } : DEFAULT_TIMING;
}

export type DeliveryResult = { ok: true } | { ok: false; error: string };

const pending = new Set<Promise<DeliveryResult>>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
}

/** A 5xx answer from the server (unknown mailbox, policy) will not get better by asking again. */
function isPermanent(error: unknown): boolean {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}

/** Our own deadline fired: the attempt was abandoned, not known to have failed. */
class DeadlineError extends Error {}

const isBillingKind = (kind: EmailKind) =>
  (BILLING_EMAIL_KINDS as readonly string[]).includes(kind);

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DeadlineError(`Email delivery timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Delivers now (no queue) and reports the outcome instead of throwing. */
export async function sendEmail(message: EmailMessage): Promise<DeliveryResult> {
  const log = getLogger();
  const outgoing = { ...message, from: emailFrom() };
  let lastError: unknown;
  let outcomeUnknown = false;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await withDeadline(getEmailTransport().send(outgoing), timing.timeoutMs);
      return { ok: true };
    } catch (error) {
      lastError = error;
      outcomeUnknown = error instanceof DeadlineError && isBillingKind(message.kind);
      if (attempt === 1 && !isPermanent(error) && !outcomeUnknown) {
        log.warn('Email delivery failed, retrying once', {
          component: 'email',
          kind: message.kind,
          to: maskEmail(message.to),
          reason: describeError(error),
        });
        await sleep(timing.retryDelayMs);
        continue;
      }
      break;
    }
  }
  const reason = outcomeUnknown
    ? `${describeError(lastError)}; the relay may still accept it, so it is not sent again`
    : describeError(lastError);
  log.error('Email could not be delivered', {
    component: 'email',
    kind: message.kind,
    to: maskEmail(message.to),
    reason,
    ...(outcomeUnknown ? { outcomeUnknown } : {}),
  });
  try {
    recordFailedDelivery(outgoing, reason);
  } catch (err) {
    log.error('Could not record the failed email delivery', { component: 'email', err });
  }
  return { ok: false, error: reason };
}

/**
 * Sends in the background: returns at once, the delivery runs on a later turn of the event loop.
 * Use {@link flushEmails} to wait for the outstanding ones (tests, scripts, shutdown).
 */
export function queueEmail(message: EmailMessage): void {
  const task = new Promise<DeliveryResult>((resolve) => {
    setImmediate(() => {
      sendEmail(message).then(resolve, (err: unknown) => {
        // sendEmail reports failures as values; this only guards against a bug in it.
        getLogger().error('Email delivery crashed', { component: 'email', err });
        resolve({ ok: false, error: describeError(err) });
      });
    });
  });
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

/** Resolves when every message queued so far was delivered or given up on. */
export async function flushEmails(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
