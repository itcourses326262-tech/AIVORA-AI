import 'server-only';

// Transactional email: templates, a transport (SMTP, or the outbox when SMTP is not configured)
// and a background queue. Routes call `queueEmail`; scripts and tests call `sendEmail` or
// `flushEmails`.
export { appLink } from './links';
export {
  clearOutbox,
  getOutbox,
  lastOutboxMessage,
  outboxFilePath,
  type OutboxEntry,
} from './outbox';
export {
  flushEmails,
  queueEmail,
  sendEmail,
  setEmailTimingForTests,
  type DeliveryResult,
} from './send';
export {
  createSmtpTransport,
  isSingleAddress,
  smtpSettingsFromEnv,
  type SmtpSettings,
} from './smtp';
export { renderEmail, type EmailSpec } from './templates/render';
export {
  DEFAULT_FROM,
  emailFrom,
  getEmailTransport,
  isSmtpConfigured,
  setEmailTransportOverride,
} from './transport';
export { EMAIL_KINDS, maskEmail } from './types';
export type { EmailKind, EmailMessage, EmailTransport, OutgoingEmail } from './types';
