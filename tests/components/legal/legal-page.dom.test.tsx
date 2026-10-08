import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegalPage, type LegalPageProps } from '@/components/legal/legal-page';
import { axeViolations } from '../axe';

const props = (overrides: Partial<LegalPageProps> = {}): LegalPageProps => ({
  eyebrow: 'Legal',
  title: 'Terms of Service',
  summary: 'How you may use the service.',
  updatedLabel: 'Last updated October 8, 2026',
  updatedIso: '2026-10-08',
  draft: { title: 'Draft — pending legal review', body: 'Not reviewed by a lawyer yet.' },
  tocLabel: 'On this page',
  sections: [
    { id: 'about', number: '1', title: 'About', children: <p>About text.</p> },
    { id: 'your-content', number: '2', title: 'Your content', children: <p>Content text.</p> },
    { id: 'law', number: '3', title: 'Law', children: <p>Law text.</p> },
  ],
  related: {
    label: 'Other legal documents',
    links: [
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refunds', label: 'Refund Policy' },
    ],
  },
  ...overrides,
});

describe('LegalPage', () => {
  it('is one page landmark with one heading, a labelled article and numbered sections', () => {
    const { container } = render(<LegalPage {...props()} />);
    const mains = container.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main-content');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      '1About',
      '2Your content',
      '3Law',
    ]);
    for (const id of ['about', 'your-content', 'law']) {
      const section = container.querySelector(`section#${id}`);
      expect(section).toHaveAttribute('aria-labelledby', `${id}-title`);
      expect(container.querySelector(`#${id}-title`)).toBeInTheDocument();
    }
  });

  it('has a table of contents whose anchors all point at a section that exists', () => {
    const { container } = render(<LegalPage {...props()} />);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const targets = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(targets).toEqual(['#about', '#your-content', '#law']);
    for (const target of targets) {
      expect(container.querySelector(target as string), target as string).toBeInTheDocument();
    }
  });

  it('offers the same links in the collapsed contents used on small screens', () => {
    const { container } = render(<LegalPage {...props()} />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('summary')?.textContent).toBe('On this page');
    const links = [...(details?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#about', '#your-content', '#law']);
  });

  it('shows the draft notice when there is one, and not otherwise', () => {
    const { container, rerender } = render(<LegalPage {...props()} />);
    const note = screen.getByRole('note', { name: 'Draft — pending legal review' });
    expect(note).toHaveTextContent('Not reviewed by a lawyer yet.');
    expect(container.querySelector('[data-legal-draft]')).toBeInTheDocument();

    rerender(<LegalPage {...props({ draft: null })} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(container.querySelector('[data-legal-draft]')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('pending legal review');
  });

  it('states when the document was last updated, as a machine-readable date too', () => {
    const { container } = render(<LegalPage {...props()} />);
    const time = container.querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-10-08');
    expect(time).toHaveTextContent('Last updated October 8, 2026');
  });

  it('links to the other documents', () => {
    render(<LegalPage {...props()} />);
    const nav = screen.getByRole('navigation', { name: 'Other legal documents' });
    expect(within(nav).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(nav).getByRole('link', { name: 'Refund Policy' })).toHaveAttribute(
      'href',
      '/refunds',
    );
  });

  it('prints without the contents and the related links, but keeps the draft notice', () => {
    const { container } = render(<LegalPage {...props()} />);
    expect(screen.getByRole('navigation', { name: 'On this page' }).className).toContain(
      'print:hidden',
    );
    expect(container.querySelector('details')?.className).toContain('print:hidden');
    expect(screen.getByRole('navigation', { name: 'Other legal documents' }).className).toContain(
      'print:hidden',
    );
    expect(container.querySelector('[data-legal-draft]')?.className ?? '').not.toContain(
      'print:hidden',
    );
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@media print');
    expect(css).toContain('body header, body footer { display: none !important; }');
  });

  it('uses no <header> or <footer> of its own (the print rule hides the site chrome by element)', () => {
    const { container } = render(<LegalPage {...props()} />);
    expect(container.querySelector('header, footer')).toBeNull();
  });

  it('has no accessibility violations, in English and in Arabic', async () => {
    const english = render(<LegalPage {...props()} />);
    expect(await axeViolations(english.container)).toEqual([]);
    english.unmount();

    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    const arabic = render(
      <LegalPage
        {...props({
          eyebrow: 'الوثائق القانونية',
          title: 'شروط الخدمة',
          summary: 'كيف يمكنك استخدام الخدمة.',
          updatedLabel: 'آخر تحديث: ٨ أكتوبر ٢٠٢٦',
          tocLabel: 'في هذه الصفحة',
          draft: { title: 'مسودة — بانتظار المراجعة القانونية', body: 'لم يراجعها محامٍ بعد.' },
          related: {
            label: 'وثائق قانونية أخرى',
            links: [{ href: '/privacy', label: 'سياسة الخصوصية' }],
          },
        })}
      />,
    );
    expect(await axeViolations(arabic.container)).toEqual([]);
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });
});
