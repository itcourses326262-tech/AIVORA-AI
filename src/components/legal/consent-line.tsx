'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { LEGAL_PATHS } from '@/lib/legal';

const linkClass =
  'rounded-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 transition-colors hover:decoration-brand';

/** `id` of the paragraph, so the submit button can be described by it. */
export const CONSENT_LINE_ID = 'legal-consent';

/**
 * "By creating an account, you agree to the Terms of Service and the Privacy Policy" with both
 * documents linked. The sentence comes from the dictionary with `{terms}` and `{privacy}` where the
 * links go, so Arabic can order the words its own way. The documents open in a new tab, so the
 * half-filled form stays where it is; the link names say so for screen reader users.
 */
export function ConsentLine() {
  const { t } = useI18n();
  const pieces = t('legal.consent.line').split(/(\{terms\}|\{privacy\})/);
  const link = (href: string, label: string) => (
    <Link href={href} target="_blank" rel="noopener" className={linkClass}>
      {label}
      <span className="sr-only"> ({t('legal.consent.newTab')})</span>
    </Link>
  );
  return (
    <p id={CONSENT_LINE_ID} className="text-sm leading-6 text-muted">
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {piece === '{terms}'
            ? link(LEGAL_PATHS.terms, t('legal.nav.terms'))
            : piece === '{privacy}'
              ? link(LEGAL_PATHS.privacy, t('legal.nav.privacy'))
              : piece}
        </Fragment>
      ))}
    </p>
  );
}
