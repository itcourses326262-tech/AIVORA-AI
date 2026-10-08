import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPANY_ENV,
  COMPANY_FIELDS,
  isPlainEmail,
  missingCompanyFields,
  readCompanyInfo,
} from '@/lib/legal';

const FULL = {
  COMPANY_NAME: 'Example Trading Co.',
  COMPANY_ADDRESS: 'King Fahd Road, Riyadh',
  COMPANY_CR_NUMBER: '1010000000',
  VAT_NUMBER: '300000000000003',
  CONTACT_EMAIL: 'legal@example.com',
  SUPPORT_EMAIL: 'support@example.com',
};

describe('readCompanyInfo', () => {
  it('reports every detail as unset for an empty environment', () => {
    const info = readCompanyInfo({});
    for (const field of COMPANY_FIELDS) expect(info[field], field).toBeNull();
    expect(missingCompanyFields(info)).toEqual([...COMPANY_FIELDS]);
  });

  it('reads each detail from its own variable', () => {
    expect(readCompanyInfo(FULL)).toEqual({
      companyName: 'Example Trading Co.',
      companyAddress: 'King Fahd Road, Riyadh',
      companyCr: '1010000000',
      vatNumber: '300000000000003',
      contactEmail: 'legal@example.com',
      supportEmail: 'support@example.com',
    });
    expect(missingCompanyFields(readCompanyInfo(FULL))).toEqual([]);
  });

  it('keeps Arabic details as they are', () => {
    const info = readCompanyInfo({ ...FULL, COMPANY_NAME: 'شركة المثال للتجارة' });
    expect(info.companyName).toBe('شركة المثال للتجارة');
  });

  it('counts blank values as unset and flattens whitespace and control characters', () => {
    const info = readCompanyInfo({
      COMPANY_NAME: '   ',
      COMPANY_ADDRESS: '  King Fahd Road,\n\t Riyadh \u0000​ ',
      VAT_NUMBER: '',
    });
    expect(info.companyName).toBeNull();
    expect(info.vatNumber).toBeNull();
    expect(info.companyAddress).toBe('King Fahd Road, Riyadh');
  });

  it('ignores a value that is absurdly long', () => {
    expect(readCompanyInfo({ COMPANY_NAME: 'x'.repeat(301) }).companyName).toBeNull();
    expect(readCompanyInfo({ COMPANY_NAME: 'x'.repeat(300) }).companyName).toHaveLength(300);
  });

  it.each([
    ['not an address', 'legal'],
    ['a display name', 'Legal <legal@example.com>'],
    ['two recipients', 'a@example.com,b@example.com'],
    ['two recipients with a semicolon', 'a@example.com;b@example.com'],
    ['mailto parameters', 'a@example.com?subject=hi&bcc=evil@example.com'],
    ['a scheme', 'mailto:a@example.com'],
    ['a javascript url', 'javascript:alert(1)'],
    ['quotes', '"a"@example.com'],
    ['a missing domain dot', 'a@localhost'],
  ])(
    'treats an email that is %s as not configured, so it can never become a hijacked link',
    (_n, value) => {
      expect(readCompanyInfo({ CONTACT_EMAIL: value }).contactEmail).toBeNull();
      expect(readCompanyInfo({ SUPPORT_EMAIL: value }).supportEmail).toBeNull();
    },
  );

  it.each(['legal@example.com', 'first.last+tag@mail.example.co.uk', 'a_b-c@sub.example.sa'])(
    'accepts the plain address %s',
    (value) => {
      expect(isPlainEmail(value)).toBe(true);
      expect(readCompanyInfo({ CONTACT_EMAIL: value }).contactEmail).toBe(value);
    },
  );

  it('does not apply the email rule to the other details', () => {
    expect(readCompanyInfo({ COMPANY_NAME: 'A & B <Trading>' }).companyName).toBe(
      'A & B <Trading>',
    );
  });
});

describe('.env.example', () => {
  const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');

  it('documents every variable the legal pages read, left blank', () => {
    for (const field of COMPANY_FIELDS) {
      expect(example, COMPANY_ENV[field]).toMatch(new RegExp(`^${COMPANY_ENV[field]}=$`, 'm'));
    }
  });
});
