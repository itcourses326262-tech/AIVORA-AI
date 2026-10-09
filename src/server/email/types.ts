import 'server-only';
import type { Locale } from '@/lib/i18n/locales';

/**
 * Mails about money, sent by billing after a state change committed (see `server/billing/mail.ts`).
 * They go to the account's address whether or not it is confirmed, and never carry a token: the
 * only link that is not a plain page of this site is the payment page of a renewal.
 */
export const BILLING_EMAIL_KINDS = [
  'payment_receipt',
  'renewal_link',
  'payment_overdue',
  'subscription_expired',
  'refund_notice',
  'subscription_canceled',
  'subscription_resumed',
] as const;
export type BillingEmailKind = (typeof BILLING_EMAIL_KINDS)[number];

export const EMAIL_KINDS = [
  'verification',
  'password_reset',
  'password_changed',
  'welcome',
  'account_deleted',
  ...BILLING_EMAIL_KINDS,
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** A finished message: the template already ran, every interpolated value is escaped. */
export interface EmailMessage {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  locale: Locale;
}

/** A message with the `From` header resolved, as handed to a transport. */
export type OutgoingEmail = EmailMessage & { from: string };

export interface EmailTransport {
  /** `smtp` for a real relay, `outbox` for the in-memory/file one. */
  readonly name: 'smtp' | 'outbox';
  /** Resolves once the message was accepted; rejects when it was not. */
  send(message: OutgoingEmail): Promise<void>;
}

/** `a***@example.com`: enough to recognize a recipient in a log, not enough to use it. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}
