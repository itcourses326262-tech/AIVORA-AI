/**
 * Configuration of the legal pages (terms, privacy, refunds, acceptable use), shared by the pages,
 * the footer, the register form and the sitemap. Isomorphic: no secrets, no I/O at import time.
 *
 * The pages are DRAFTS for the owner's counsel to review; nothing here is legal advice. What the
 * owner has to do before launch:
 *  1. Set the company details in the environment (see `.env.example`): they render as clearly
 *     marked placeholders until they are set, and are never invented.
 *  2. Have a lawyer review `src/lib/i18n/messages/legal.ts` (every "to confirm" flag in the text
 *     marks a decision that is theirs), then set `LEGAL_DRAFT` to `false`.
 *  3. Bump the `LEGAL_LAST_UPDATED` date of every document that changed.
 */

/**
 * True while the documents are templates awaiting legal review. It shows the "Draft — pending
 * legal review" notice on every legal page and the "to confirm" flags inside the text. Flip it to
 * `false` once counsel has approved the wording.
 */
export const LEGAL_DRAFT = true;

export const LEGAL_SLUGS = ['terms', 'privacy', 'refunds', 'acceptable-use'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** The route of each document. They live in the `(marketing)` group, so they get the site chrome. */
export const LEGAL_PATHS = {
  terms: '/terms',
  privacy: '/privacy',
  refunds: '/refunds',
  'acceptable-use': '/acceptable-use',
} as const satisfies Record<LegalSlug, `/${string}`>;

/** Key of each document inside the `legal` message namespace (`legal.<key>.title`). */
export const LEGAL_MESSAGE_KEY = {
  terms: 'terms',
  privacy: 'privacy',
  refunds: 'refunds',
  'acceptable-use': 'acceptableUse',
} as const satisfies Record<LegalSlug, string>;

export type LegalMessageKey = (typeof LEGAL_MESSAGE_KEY)[LegalSlug];

/** ISO date (UTC) of the last change to each document's wording. Bump it when the text changes. */
export const LEGAL_LAST_UPDATED = {
  terms: '2026-10-08',
  privacy: '2026-10-08',
  refunds: '2026-10-08',
  'acceptable-use': '2026-10-08',
} as const satisfies Record<LegalSlug, string>;

/**
 * Days after a purchase in which unused credits can be refunded (refund policy). A DRAFT default
 * for the owner and counsel to decide; the text shows it with a "to confirm" flag.
 */
export const REFUND_WINDOW_DAYS = 7;

/**
 * Internal pages the text of a legal document may link to (`[label](/path)`). Anything else is
 * rendered as plain text, so a typo in a dictionary can never produce a dead or foreign link.
 */
export const LEGAL_LINK_TARGETS: readonly string[] = [...Object.values(LEGAL_PATHS), '/account'];

export function isLegalSlug(value: unknown): value is LegalSlug {
  return typeof value === 'string' && (LEGAL_SLUGS as readonly string[]).includes(value);
}

/** Midnight UTC of a document's last-updated date, in milliseconds (format it with `timeZone: 'UTC'`). */
export function lastUpdatedMs(slug: LegalSlug): number {
  return Date.parse(`${LEGAL_LAST_UPDATED[slug]}T00:00:00Z`);
}

// ---- Company details --------------------------------------------------------------------------

export const COMPANY_FIELDS = [
  'companyName',
  'companyAddress',
  'companyCr',
  'vatNumber',
  'contactEmail',
  'supportEmail',
] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** The environment variable each detail is read from. */
export const COMPANY_ENV = {
  companyName: 'COMPANY_NAME',
  companyAddress: 'COMPANY_ADDRESS',
  companyCr: 'COMPANY_CR_NUMBER',
  vatNumber: 'VAT_NUMBER',
  contactEmail: 'CONTACT_EMAIL',
  supportEmail: 'SUPPORT_EMAIL',
} as const satisfies Record<CompanyField, string>;

/** `null` = not configured. The pages then show a marked placeholder instead of inventing a value. */
export type CompanyInfo = Readonly<Record<CompanyField, string | null>>;

export const EMAIL_FIELDS: ReadonlySet<CompanyField> = new Set(['contactEmail', 'supportEmail']);

const MAX_FIELD_LENGTH = 300;
// One address, nothing else: no spaces, quotes, angle brackets, commas or semicolons, so the value
// is safe inside a `mailto:` link (no extra recipients, no `?subject=` / `?body=` parameters).
const SIMPLE_EMAIL =
  /^[^\s@<>"'`,;:()[\]\\?&#%/]+@[^\s@<>"'`,;:()[\]\\?&#%/]+\.[^\s@<>"'`,;:()[\]\\?&#%/]+$/;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/** Whether `value` is one plain email address that may be linked as `mailto:`. */
export function isPlainEmail(value: string): boolean {
  return value.length <= 254 && SIMPLE_EMAIL.test(value);
}

function cleanField(field: CompanyField, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  if (value === '' || value.length > MAX_FIELD_LENGTH) return null;
  // A malformed address would become a broken or hijackable link: treat it as not configured.
  if (EMAIL_FIELDS.has(field) && !isPlainEmail(value)) return null;
  return value;
}

/**
 * The company details from the environment. Blank values count as unset; control characters and
 * runs of whitespace are flattened; an email that is not a single plain address counts as unset.
 * `source` is injectable for tests; read it per request (the pages are dynamic), never at import.
 */
export function readCompanyInfo(
  source: Readonly<Record<string, string | undefined>> = process.env,
): CompanyInfo {
  const info = {} as Record<CompanyField, string | null>;
  for (const field of COMPANY_FIELDS) info[field] = cleanField(field, source[COMPANY_ENV[field]]);
  return info;
}

/** Company details that are still unset, for tests and for operators checking a deployment. */
export function missingCompanyFields(info: CompanyInfo): CompanyField[] {
  return COMPANY_FIELDS.filter((field) => info[field] === null);
}
