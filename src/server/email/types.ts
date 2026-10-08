import 'server-only';
import type { Locale } from '@/lib/i18n/locales';

export const EMAIL_KINDS = [
  'verification',
  'password_reset',
  'password_changed',
  'welcome',
  'account_deleted',
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
