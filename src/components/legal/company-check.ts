import {
  COMPANY_ENV,
  missingCompanyFields,
  type CompanyField,
  type CompanyInfo,
} from '@/lib/legal';
import { getLogger, type Logger } from '@/server/logger';

export type MissingDetailsReporter = (company: CompanyInfo, draft: boolean) => void;

/**
 * A reporter that warns the operator, once per process and per set of missing details, when the
 * documents are declared final (`LEGAL_DRAFT` is off) while company details are still unset. The
 * pages show a marked placeholder for each one, so a visitor would see "[Company name: to be
 * provided]" on a launched site: this is the line in the log that says so before they do. While the
 * draft flag is on, missing details are expected and nothing is reported. Only variable names are
 * logged, never values.
 */
export function createMissingDetailsReporter(
  log: () => Logger = getLogger,
): MissingDetailsReporter {
  const reported = new Set<string>();
  return (company, draft) => {
    if (draft) return;
    const missing: CompanyField[] = missingCompanyFields(company);
    if (missing.length === 0) return;
    const signature = missing.join(',');
    if (reported.has(signature)) return;
    reported.add(signature);
    log().warn('legal pages are final but company details are not configured', {
      missing: missing.map((field) => COMPANY_ENV[field]),
    });
  };
}

/** The reporter the legal pages use. */
export const reportMissingCompanyDetails: MissingDetailsReporter = createMissingDetailsReporter();
