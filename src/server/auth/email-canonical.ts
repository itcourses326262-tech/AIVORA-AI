import 'server-only';

/**
 * The mailbox an address delivers to, for telling aliases of one mailbox apart from different
 * ones. `a.b+promo@gmail.com`, `ab@gmail.com` and `a.b@googlemail.com` all land in the same Gmail
 * inbox, so they share one canonical form and cannot each claim a sign-up bonus.
 *
 * - `+tag` is dropped on every domain: nearly all providers (and every custom domain on Google
 *   Workspace or Microsoft 365) deliver `name+anything` to `name`. Only a mailbox literally named
 *   with a plus sign would be misjudged, which is vanishingly rare.
 * - Dots are ignored only for Gmail and Googlemail, where they are meaningless; everywhere else
 *   `a.b` and `ab` are different mailboxes.
 *
 * The result is for comparison only: the account keeps the address as typed.
 */

const DOT_INSENSITIVE_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

export function canonicalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return email;

  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  // A leading plus is part of the name, not a tag: stripping it would leave nothing.
  if (plus > 0) local = local.slice(0, plus);
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
