import 'server-only';
import { formatDateTime } from '@/lib/utils';
import type { EmailMessage } from '../types';
import { emailCopy } from './copy';
import { creditsLabel, duration, paragraph, type Common, type Value } from './fill';
import { renderBillingEmail, type BillingEmailSpec } from './billing';
import { renderLayout, singleLine, type Paragraph } from './layout';

type Dictionary = (typeof emailCopy)['en'];

export type EmailSpec =
  // Confirming an address pays no credits (the free ones are for Google sign-in), so this mail
  // never talks about credits.
  | (Common & { kind: 'verification'; link: string; ttlHours: number })
  | (Common & { kind: 'password_reset'; link: string; ttlHours: number })
  | (Common & {
      kind: 'password_changed';
      /** Where the user can start a reset if it was not them. */
      link: string;
      at: number;
      /** API keys the reset revoked (0 or absent: the notice does not mention keys). */
      keysRevoked?: number;
    })
  | (Common & {
      kind: 'welcome';
      link: string;
      /** Free credits this account was given on joining (0 or absent: the mail does not mention any). */
      bonusCredits?: number;
    })
  | (Common & { kind: 'account_deleted' })
  | BillingEmailSpec;

/** Builds the subject, HTML and plain-text bodies of one email. Pure: no I/O, no clock. */
export function renderEmail(spec: EmailSpec): EmailMessage {
  switch (spec.kind) {
    case 'payment_receipt':
    case 'renewal_link':
    case 'payment_overdue':
    case 'subscription_expired':
    case 'refund_notice':
    case 'subscription_canceled':
    case 'subscription_resumed':
      return renderBillingEmail(spec);
    default:
      return renderAccountEmail(spec);
  }
}

type AccountEmailSpec = Exclude<EmailSpec, BillingEmailSpec>;

function renderAccountEmail(spec: AccountEmailSpec): EmailMessage {
  const { locale } = spec;
  const c: Dictionary = emailCopy[locale];
  const to = spec.to;
  const email: Value = { value: to, ltr: true, strong: true };
  const name: Value = { value: spec.name };
  const greeting = paragraph(c.shared.greeting, { name }, locale);

  const base = { locale, brand: c.brand, linkHint: c.shared.linkHint };
  const footer = paragraph(c.shared.sentTo, { email: { value: to, ltr: true } }, locale, 'muted');

  switch (spec.kind) {
    case 'verification':
      return build(spec, c.verification.subject, {
        ...base,
        subject: c.verification.subject,
        preheader: c.verification.preheader,
        heading: c.verification.heading,
        paragraphs: [
          greeting,
          paragraph(c.verification.intro, { email }, locale),
          paragraph(
            c.verification.expiry,
            { duration: { value: duration(locale, 'hour', spec.ttlHours) } },
            locale,
            'muted',
          ),
          paragraph(c.verification.ignore, {}, locale, 'muted'),
        ],
        action: { label: c.verification.action, url: spec.link },
        footer,
      });
    case 'password_reset':
      return build(spec, c.passwordReset.subject, {
        ...base,
        subject: c.passwordReset.subject,
        preheader: c.passwordReset.preheader,
        heading: c.passwordReset.heading,
        paragraphs: [
          greeting,
          paragraph(c.passwordReset.intro, { email }, locale),
          paragraph(
            c.passwordReset.expiry,
            { duration: { value: duration(locale, 'hour', spec.ttlHours) } },
            locale,
            'muted',
          ),
          paragraph(c.passwordReset.ignore, {}, locale, 'muted'),
          paragraph(c.passwordReset.secret, {}, locale, 'muted'),
        ],
        action: { label: c.passwordReset.action, url: spec.link },
        footer,
      });
    case 'password_changed': {
      const lines: Paragraph[] = [
        greeting,
        paragraph(
          c.passwordChanged.intro,
          { email, time: { value: `${formatDateTime(spec.at, locale, 'UTC')} UTC`, ltr: true } },
          locale,
        ),
      ];
      if (spec.keysRevoked && spec.keysRevoked > 0) {
        lines.push(paragraph(c.passwordChanged.keysRevoked, {}, locale));
      }
      lines.push(paragraph(c.passwordChanged.warning, {}, locale, 'warning'));
      return build(spec, c.passwordChanged.subject, {
        ...base,
        subject: c.passwordChanged.subject,
        preheader: c.passwordChanged.preheader,
        heading: c.passwordChanged.heading,
        paragraphs: lines,
        action: { label: c.passwordChanged.action, url: spec.link },
        footer,
      });
    }
    case 'welcome': {
      const lines: Paragraph[] = [greeting, paragraph(c.welcome.intro, {}, locale)];
      if (spec.bonusCredits && spec.bonusCredits > 0) {
        const credits: Value = { value: creditsLabel(locale, spec.bonusCredits), strong: true };
        lines.push(paragraph(c.welcome.bonus, { credits }, locale));
      }
      return build(spec, c.welcome.subject, {
        ...base,
        subject: c.welcome.subject,
        preheader: c.welcome.preheader,
        heading: c.welcome.heading,
        paragraphs: lines,
        action: { label: c.welcome.action, url: spec.link },
        footer,
      });
    }
    case 'account_deleted':
      return build(spec, c.accountDeleted.subject, {
        ...base,
        subject: c.accountDeleted.subject,
        preheader: c.accountDeleted.preheader,
        heading: c.accountDeleted.heading,
        paragraphs: [
          greeting,
          paragraph(c.accountDeleted.intro, { email }, locale),
          paragraph(c.accountDeleted.records, {}, locale, 'muted'),
          paragraph(c.accountDeleted.warning, {}, locale, 'warning'),
        ],
        footer,
      });
  }
}

function build(
  spec: EmailSpec,
  subject: string,
  layout: Parameters<typeof renderLayout>[0],
): EmailMessage {
  const { html, text } = renderLayout(layout);
  return {
    kind: spec.kind,
    to: spec.to,
    subject: singleLine(subject),
    html,
    text,
    locale: spec.locale,
  };
}
