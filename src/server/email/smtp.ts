import 'server-only';
import type { Transporter } from 'nodemailer';
import type { Env } from '@/server/env';
import type { EmailTransport, OutgoingEmail } from './types';

/** The connection settings SMTP_URL or SMTP_HOST/PORT/USER/PASS/SECURE describe. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** TLS from the first byte (port 465 style). */
  secure: boolean;
  /** Refuse to log in over a connection that cannot be upgraded to TLS. */
  requireTLS: boolean;
  auth?: { user: string; pass: string };
}

type SmtpEnv = Pick<
  Env,
  'SMTP_URL' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_SECURE'
>;

const SUBMISSION_PORT = 587;
const SMTPS_PORT = 465;

/** Null when SMTP is not configured. `SMTP_URL` wins over the separate variables. */
export function smtpSettingsFromEnv(env: SmtpEnv): SmtpSettings | null {
  if (env.SMTP_URL) {
    const url = new URL(env.SMTP_URL);
    const secure = url.protocol === 'smtps:' || env.SMTP_SECURE;
    const user = decodeURIComponent(url.username);
    const auth = user ? { user, pass: decodeURIComponent(url.password) } : undefined;
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : secure ? SMTPS_PORT : SUBMISSION_PORT,
      secure,
      // Credentials are only ever sent over TLS, whether implicit or after STARTTLS.
      requireTLS: auth !== undefined && !secure,
      ...(auth ? { auth } : {}),
    };
  }
  if (!env.SMTP_HOST) return null;
  const secure = env.SMTP_SECURE;
  const auth = env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? (secure ? SMTPS_PORT : SUBMISSION_PORT),
    secure,
    requireTLS: auth !== undefined && !secure,
    ...(auth ? { auth } : {}),
  };
}

export interface SmtpTransportDeps {
  /** Loads nodemailer; a test supplies one that builds a stub transporter instead. */
  createTransporter?: (settings: SmtpSettings) => Promise<Pick<Transporter, 'sendMail'>>;
}

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

async function createNodemailerTransporter(
  settings: SmtpSettings,
): Promise<Pick<Transporter, 'sendMail'>> {
  // Loaded on first use: most processes (and every test) never send through SMTP.
  const { createTransport } = await import('nodemailer');
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    ...(settings.auth ? { auth: settings.auth } : {}),
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    tls: { minVersion: 'TLSv1.2' },
  });
}

/** `to` must be exactly one plain address: no lists, display names or header injection. */
const SINGLE_ADDRESS = /^[^\s,;<>"'()[\]\\:@]+@[^\s,;<>"'()[\]\\:@]+$/;

export function isSingleAddress(address: string): boolean {
  return SINGLE_ADDRESS.test(address) && address.length <= 254;
}

export function createSmtpTransport(
  settings: SmtpSettings,
  deps: SmtpTransportDeps = {},
): EmailTransport {
  const create = deps.createTransporter ?? createNodemailerTransporter;
  let transporter: Promise<Pick<Transporter, 'sendMail'>> | undefined;
  return {
    name: 'smtp',
    async send(message: OutgoingEmail): Promise<void> {
      if (!isSingleAddress(message.to)) throw new Error('Refusing to send to a malformed address');
      transporter ??= create(settings);
      let active: Pick<Transporter, 'sendMail'>;
      try {
        active = await transporter;
      } catch (error) {
        transporter = undefined; // a failed load must not be remembered
        throw error;
      }
      const info = await active.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: {
          // Transactional mail: auto-responders and out-of-office replies must stay quiet.
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
        },
      });
      const rejected: unknown = info.rejected;
      if (Array.isArray(rejected) && rejected.length > 0) {
        throw new Error('The SMTP server did not accept the recipient');
      }
    },
  };
}
