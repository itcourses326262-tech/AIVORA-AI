import { describe, expect, it, vi } from 'vitest';
import { createMissingDetailsReporter } from '@/components/legal/company-check';
import { COMPANY_ENV, readCompanyInfo } from '@/lib/legal';
import type { Logger } from '@/server/logger';

const COMPLETE = {
  COMPANY_NAME: 'Example Trading Co.',
  COMPANY_ADDRESS: 'King Fahd Road, Riyadh',
  COMPANY_CR_NUMBER: '1010000000',
  VAT_NUMBER: '300000000000003',
  CONTACT_EMAIL: 'legal@example.com',
  SUPPORT_EMAIL: 'support@example.com',
};

function setup() {
  const warn = vi.fn();
  const report = createMissingDetailsReporter(() => ({ warn }) as unknown as Logger);
  return { warn, report };
}

describe('the warning about company details that are still missing', () => {
  it('stays silent while the documents are drafts: placeholders are expected then', () => {
    const { warn, report } = setup();
    report(readCompanyInfo({}), true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once the draft flag is off and details are missing, naming the variables', () => {
    const { warn, report } = setup();
    report(readCompanyInfo({}), false);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, fields] = warn.mock.calls[0] as [string, { missing: string[] }];
    expect(message).toBe('legal pages are final but company details are not configured');
    expect(fields.missing).toEqual(Object.values(COMPANY_ENV));
  });

  it('names only the details that are missing, and never logs a value', () => {
    const { warn, report } = setup();
    report(readCompanyInfo({ ...COMPLETE, VAT_NUMBER: '', SUPPORT_EMAIL: 'not an email' }), false);
    expect(warn).toHaveBeenCalledTimes(1);
    const fields = warn.mock.calls[0]?.[1] as { missing: string[] };
    expect(fields.missing).toEqual(['VAT_NUMBER', 'SUPPORT_EMAIL']);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Example Trading');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('legal@example.com');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('300000000000003');
  });

  it('is silent when every detail is set', () => {
    const { warn, report } = setup();
    report(readCompanyInfo(COMPLETE), false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once per set of missing details, not on every page view', () => {
    const { warn, report } = setup();
    const none = readCompanyInfo({});
    for (let view = 0; view < 5; view += 1) report(none, false);
    expect(warn).toHaveBeenCalledTimes(1);
    // A different gap is news again; the same one stays quiet.
    report(readCompanyInfo({ ...COMPLETE, COMPANY_NAME: '' }), false);
    report(readCompanyInfo({ ...COMPLETE, COMPANY_NAME: '' }), false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a gap it already reported, even after the details were fixed in between', () => {
    const { warn, report } = setup();
    const gap = readCompanyInfo({ ...COMPLETE, VAT_NUMBER: '' });
    report(gap, false);
    report(readCompanyInfo(COMPLETE), false);
    report(gap, false);
    // Deduplicated per distinct set for the life of the process: the line is already in the log.
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
