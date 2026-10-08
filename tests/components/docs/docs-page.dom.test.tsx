import { describe, expect, it } from 'vitest';
import { DocsPage } from '@/components/docs/docs-page';
import { createTranslator, type Locale } from '@/lib/i18n';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import { axeViolations } from '../axe';
import { renderUi } from '../render';

const ORIGIN = 'https://aivore.example';
const document = buildOpenApiDocument(ORIGIN);

function renderDocs(locale: Locale) {
  return renderUi(
    <DocsPage
      i18n={createTranslator(locale)}
      document={document}
      origin={ORIGIN}
      quickstart={{ modelId: 'aivore-demo-image', aspectRatio: '16:9', cost: 1, usable: true }}
      initialLanguage="bash"
    />,
    { locale },
  );
}

describe.each(['en', 'ar'] as const)('the documentation page, rendered (%s)', (locale) => {
  it('has no accessibility violations, including repeated example names', async () => {
    const { container } = renderDocs(locale);
    expect(await axeViolations(container)).toEqual([]);
    // The whole reference is audited at once, which takes a while without a layout engine.
  }, 90_000);

  it('gives every code window its own name', () => {
    const { container } = renderDocs(locale);
    const names = [...container.querySelectorAll('pre[role="region"]')].map((node) =>
      node.getAttribute('aria-label'),
    );
    expect(names.length).toBeGreaterThan(40);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every code block left to right', () => {
    const { container } = renderDocs(locale);
    const blocks = [...container.querySelectorAll('pre')];
    expect(blocks.length).toBeGreaterThan(40);
    for (const block of blocks) {
      expect(block.closest('[dir]')).toHaveAttribute('dir', 'ltr');
    }
  });
});
