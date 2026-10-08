import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDocsNav, DocsPage } from '@/components/docs/docs-page';
import type { DocsNavNode } from '@/components/docs/docs-nav';
import { referenceGroups } from '@/components/docs/reference-model';
import type { QuickstartLanguage } from '@/components/docs/snippets';
import { createTranslator, type Locale } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/client';
import { buildOpenApiDocument } from '@/lib/openapi/spec';

const ORIGIN = 'https://aivore.example';
const doc = buildOpenApiDocument(ORIGIN);

function render(locale: Locale, language: QuickstartLanguage = 'bash'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <DocsPage
        i18n={createTranslator(locale)}
        document={doc}
        origin={ORIGIN}
        quickstart={{ modelId: 'aivore-demo-image', aspectRatio: '16:9', cost: 1, usable: true }}
        initialLanguage={language}
      />
    </I18nProvider>,
  );
}

const ids = (markup: string) =>
  new Set([...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]));
const flat = (nodes: readonly DocsNavNode[]): DocsNavNode[] =>
  nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);

describe.each(['en', 'ar'] as const)('the documentation page (%s)', (locale) => {
  const markup = render(locale);

  it('is one page with one main landmark and one h1', () => {
    expect(markup.match(/<main /g)).toHaveLength(1);
    expect(markup).toContain('<main id="main-content"');
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it('has every section, in reading order', () => {
    const order = [
      'introduction',
      'quickstart',
      'authentication',
      'lifecycle',
      'conventions',
      'errors',
      'idempotency',
      'rate-limits',
      'credits',
      'reference',
      'objects',
      'openapi',
    ];
    const positions = order.map((id) => markup.indexOf(`<section id="${id}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('has an anchor for every entry of the table of contents, in the same order', () => {
    const present = ids(markup);
    const nodes = flat(buildDocsNav(doc, createTranslator(locale)));
    expect(nodes.length).toBeGreaterThan(60);
    expect(nodes.filter((node) => !present.has(node.id)).map((node) => node.id)).toEqual([]);
    const positions = nodes.map((node) => markup.indexOf(` id="${node.id}"`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('documents every operation of the OpenAPI document', () => {
    const operations = referenceGroups(doc).flatMap((group) => group.operations);
    expect(markup.match(/<article /g)).toHaveLength(operations.length);
    for (const entry of operations) expect(markup).toContain(`id="op-${entry.id}"`);
  });

  it('keeps every code window left to right, whatever the page direction', () => {
    const windows =
      markup.match(/<div dir="ltr" class="overflow-hidden rounded-xl border border-white\/10/g) ??
      [];
    expect(windows.length).toBeGreaterThan(60);
    expect(markup.match(/<pre /g)).toHaveLength(windows.length);
    expect(markup.match(/<pre [^>]*lang="en"/g)).toHaveLength(windows.length);
  });

  it('puts the English reference in left-to-right islands and translates the labels around it', () => {
    expect(markup.match(/<article dir="ltr"/g)).toHaveLength(
      Object.values(doc.paths).flatMap((item) => Object.keys(item)).length,
    );
    const t = createTranslator(locale).t;
    expect(markup).toContain(t('account.docs.reference.englishNote'));
    expect(markup).toContain(t('account.docs.reference.requestBody'));
    expect(markup).toContain(t('account.docs.hero.title'));
  });

  it('shows no placeholder that was never filled in', () => {
    for (const placeholder of [
      '{model}',
      '{cost}',
      '{count}',
      '{max}',
      'undefined',
      '[object Object]',
      'NaN',
    ]) {
      expect(markup, placeholder).not.toContain(placeholder);
    }
  });

  it('links to key creation and to the OpenAPI document', () => {
    expect(markup).toContain('href="/account?tab=keys"');
    expect(markup).toContain('href="/api/v1/openapi.json"');
    expect(markup).toContain('https://aivore.example/api/v1');
  });
});

describe('the quickstart', () => {
  it('starts in the language the reader saved', () => {
    const python = render('en', 'python');
    expect(python).toContain('Python (requests)');
    expect(python).not.toContain('JavaScript (fetch)');
    expect(python).toMatch(/aria-checked="true"[^>]*data-state="checked"[^>]*>Python</);
    expect(render('en', 'javascript')).toContain('JavaScript (fetch)');
    expect(render('en')).toMatch(/aria-checked="true"[^>]*data-state="checked"[^>]*>cURL</);
  });

  it('shows the model and its price in words of the active language', () => {
    expect(render('en')).toContain('costs 1 credit per image');
    expect(render('ar')).toContain('aivore-demo-image');
  });

  it('numbers its steps in the numerals of the language', () => {
    expect(render('ar')).toContain('>١<');
    expect(render('en')).toContain('>1<');
  });
});

describe('the table of contents', () => {
  it('nests endpoints under their topic under the reference, with the method as a badge', () => {
    const nav = buildDocsNav(doc, createTranslator('en'));
    const reference = nav.find((node) => node.id === 'reference');
    const generations = reference?.children?.find((node) => node.id === 'ref-generations');
    expect(generations?.children?.[0]).toMatchObject({
      id: 'op-createGeneration',
      badge: 'POST',
      label: 'Create a generation',
    });
    expect(nav.map((node) => node.id)).toEqual([
      'introduction',
      'quickstart',
      'authentication',
      'lifecycle',
      'conventions',
      'errors',
      'idempotency',
      'rate-limits',
      'credits',
      'reference',
      'objects',
      'openapi',
    ]);
  });
});
