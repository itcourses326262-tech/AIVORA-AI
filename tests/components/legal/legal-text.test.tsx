import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalText, type LegalTextContext } from '@/components/legal/legal-text';
import { createTranslator } from '@/lib/i18n';
import { readCompanyInfo, type CompanyInfo } from '@/lib/legal';

const FULL: CompanyInfo = readCompanyInfo({
  COMPANY_NAME: 'Example Trading Co.',
  COMPANY_ADDRESS: 'King Fahd Road, Riyadh',
  COMPANY_CR_NUMBER: '1010000000',
  VAT_NUMBER: '300000000000003',
  CONTACT_EMAIL: 'legal@example.com',
  SUPPORT_EMAIL: 'support@example.com',
});
const EMPTY: CompanyInfo = readCompanyInfo({});

interface RenderOptions {
  locale?: 'ar' | 'en';
  company?: CompanyInfo;
  draft?: boolean;
}

function render(
  body: string,
  { locale = 'en', company = EMPTY, draft = true }: RenderOptions = {},
): string {
  const ctx: LegalTextContext = { t: createTranslator(locale).t, company, draft };
  return renderToStaticMarkup(<LegalText body={body} ctx={ctx} />);
}

describe('LegalText', () => {
  it('renders paragraphs, lists and sub-headings', () => {
    const html = render('### Part\nIntro text.\n\n- one\n- two');
    expect(html).toContain('<h3');
    expect(html).toContain('>Part</h3>');
    expect(html).toContain('<p>Intro text.</p>');
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it('shows a highlighted, labelled placeholder for every company detail that is not set', () => {
    const html = render(
      '{companyName} {companyAddress} {companyCr} {vatNumber} {contactEmail} {supportEmail}',
    );
    for (const field of [
      'companyName',
      'companyAddress',
      'companyCr',
      'vatNumber',
      'contactEmail',
      'supportEmail',
    ]) {
      expect(html).toContain(`<mark data-placeholder="${field}"`);
    }
    expect(html).toContain('[Company name: to be provided]');
    expect(html).toContain('[Commercial registration number: to be provided]');
    expect(html).toContain('[VAT number: to be provided]');
    expect(html).not.toContain('mailto:');
  });

  it('shows the placeholders in Arabic too', () => {
    const html = render('{companyName} {contactEmail}', { locale: 'ar' });
    expect(html).toContain('[اسم الشركة: يُستكمل لاحقًا]');
    expect(html).toContain('[البريد الإلكتروني للتواصل: يُستكمل لاحقًا]');
  });

  it('shows the configured details instead, with emails as mailto links', () => {
    const html = render('{companyName} / {companyCr} / {vatNumber} / {companyAddress}', {
      company: FULL,
    });
    expect(html).not.toContain('data-placeholder');
    expect(html).toContain('<bdi>Example Trading Co.</bdi>');
    expect(html).toContain('<bdi>1010000000</bdi>');
    expect(html).toContain('<bdi>300000000000003</bdi>');
    expect(html).toContain('<bdi>King Fahd Road, Riyadh</bdi>');

    const emails = render('{contactEmail} {supportEmail}', { company: FULL });
    expect(emails).toMatch(
      /<a href="mailto:legal@example\.com" dir="ltr"[^>]*>legal@example\.com<\/a>/,
    );
    expect(emails).toMatch(/<a href="mailto:support@example\.com" dir="ltr"/);
  });

  it('escapes the company details, whatever they contain', () => {
    const company = readCompanyInfo({
      COMPANY_NAME: '<img src=x onerror=alert(1)> & "Co"',
      COMPANY_ADDRESS: '<script>alert(1)</script>',
    });
    const html = render('{companyName} {companyAddress}', { company });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;');
  });

  it('puts the "to confirm" flag in a draft, and takes it away with its space once final', () => {
    const body = 'twelve months {confirm}.';
    const draft = render(body, { draft: true });
    expect(draft).toContain('data-confirm=""');
    expect(draft).toContain('To confirm');
    expect(draft).toContain('title="This wording needs to be confirmed by legal counsel"');

    const final = render(body, { draft: false });
    expect(final).not.toContain('data-confirm');
    expect(final).not.toContain('To confirm');
    expect(final).toContain('<p>twelve months.</p>');
  });

  it('keeps the company placeholders when the text is final: details are never invented', () => {
    expect(render('{companyName}', { draft: false })).toContain('data-placeholder="companyName"');
  });

  it('links only the pages the documents may link to', () => {
    const html = render(
      'See [privacy](/privacy) and [elsewhere](https://evil.example) and [odd](/admin).',
    );
    expect(html).toContain('<a class=');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('href="/admin"');
    expect(html).toContain('elsewhere');
  });

  it('renders bold and code, with code isolated left to right', () => {
    const html = render('**Never** use [[aivore_session]] twice.');
    expect(html).toContain('<strong');
    expect(html).toContain('>Never</strong>');
    expect(html).toMatch(/<code dir="ltr"[^>]*>aivore_session<\/code>/);
  });

  it('leaves an unknown token visible so a mistake in a dictionary gets noticed', () => {
    expect(render('Hello {nobody}.')).toContain('Hello {nobody}.');
  });

  it('does not render raw HTML typed into a dictionary', () => {
    const html = render('A <b>bold</b> claim <script>alert(1)</script>');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
