import { renderToStaticMarkup } from 'react-dom/server';
import type * as LoggerModule from '@/server/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ 'accept-language': 'en' }),
}));
vi.mock('@/server/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  getLogger: () => ({ warn: mocks.warn }),
}));

import { LegalDocument } from '@/components/legal/legal-document';
import { COMPANY_ENV, readCompanyInfo } from '@/lib/legal';

const COMPLETE = Object.fromEntries(
  Object.values(COMPANY_ENV).map((name) => [
    name,
    name.endsWith('EMAIL') ? 'legal@example.com' : 'x',
  ]),
);

beforeEach(() => {
  mocks.warn.mockClear();
});

describe('LegalDocument tells the operator about missing company details', () => {
  // The reporter remembers what it already said for the life of the process, so each case uses a
  // different set of gaps.
  it('is quiet while the document is a draft', async () => {
    renderToStaticMarkup(
      await LegalDocument({ slug: 'terms', company: readCompanyInfo({}), draft: true }),
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('warns once, with the variable names, when the draft flag is off and details are missing', async () => {
    const company = readCompanyInfo({ ...COMPLETE, COMPANY_CR_NUMBER: '', VAT_NUMBER: '' });
    for (const slug of ['terms', 'privacy', 'refunds', 'acceptable-use'] as const) {
      renderToStaticMarkup(await LegalDocument({ slug, company, draft: false }));
    }
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith(
      'legal pages are final but company details are not configured',
      { missing: ['COMPANY_CR_NUMBER', 'VAT_NUMBER'] },
    );
  });

  it('is quiet when the document is final and every detail is set', async () => {
    renderToStaticMarkup(
      await LegalDocument({ slug: 'terms', company: readCompanyInfo(COMPLETE), draft: false }),
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
