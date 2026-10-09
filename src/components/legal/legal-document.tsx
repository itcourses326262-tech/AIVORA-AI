import { DAY_MS, RENEWAL_GRACE_MS, RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { getI18n } from '@/lib/i18n/server';
import {
  LEGAL_DRAFT,
  LEGAL_LAST_UPDATED,
  LEGAL_MESSAGE_KEY,
  LEGAL_PATHS,
  LEGAL_SLUGS,
  REFUND_WINDOW_DAYS,
  lastUpdatedMs,
  readCompanyInfo,
  type CompanyInfo,
  type LegalSlug,
} from '@/lib/legal';
import { formatDate, formatPlainNumber } from '@/lib/utils';
import { getEnv } from '@/server/env';
import { reportMissingCompanyDetails } from './company-check';
import { LegalPage, type LegalSectionData } from './legal-page';
import { LegalText, type LegalTextContext } from './legal-text';
import { fillVariables } from './markup';
import { anchorOf, documentOf } from './outline';
import { legalVariables } from './variables';

export interface LegalDocumentProps {
  slug: LegalSlug;
  /** Defaults to the environment; injectable for tests. */
  company?: CompanyInfo;
  /** Defaults to `LEGAL_DRAFT`; injectable for tests. */
  draft?: boolean;
}

/**
 * One legal document, read from `messages/legal-documents.ts` in the active language and laid out
 * by `LegalPage`. The numbers in the text (VAT, renewal link lead time, grace period, refund
 * window) come from the same configuration the billing code uses, so the wording cannot drift from
 * what the system does.
 */
export async function LegalDocument({
  slug,
  company = readCompanyInfo(),
  draft = LEGAL_DRAFT,
}: LegalDocumentProps) {
  const i18n = await getI18n();
  const { t, locale } = i18n;
  const text = documentOf(locale, LEGAL_MESSAGE_KEY[slug]);
  const variables = legalVariables(i18n, {
    vatPercent: getEnv().VAT_RATE_PERCENT,
    leadDays: RENEWAL_LEAD_MS / DAY_MS,
    graceDays: RENEWAL_GRACE_MS / DAY_MS,
    refundDays: REFUND_WINDOW_DAYS,
  });
  const ctx: LegalTextContext = { t, company, draft };
  reportMissingCompanyDetails(company, draft);

  const sections: LegalSectionData[] = text.sections.map((section, index) => ({
    id: anchorOf(section.id),
    number: formatPlainNumber(index + 1, locale),
    title: section.title,
    children: <LegalText body={fillVariables(section.body, variables)} ctx={ctx} />,
  }));

  return (
    <LegalPage
      eyebrow={t('legal.common.eyebrow')}
      title={text.title}
      summary={text.summary}
      updatedLabel={t('legal.common.lastUpdated', {
        date: formatDate(lastUpdatedMs(slug), locale, 'long', 'UTC'),
      })}
      updatedIso={LEGAL_LAST_UPDATED[slug]}
      draft={
        draft ? { title: t('legal.common.draft.title'), body: t('legal.common.draft.body') } : null
      }
      tocLabel={t('legal.common.tocLabel')}
      sections={sections}
      related={{
        label: t('legal.common.related'),
        links: LEGAL_SLUGS.filter((other) => other !== slug).map((other) => ({
          href: LEGAL_PATHS[other],
          label: t(`legal.nav.${LEGAL_MESSAGE_KEY[other]}`),
        })),
      }}
    />
  );
}
