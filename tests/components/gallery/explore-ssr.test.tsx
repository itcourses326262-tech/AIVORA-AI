import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExploreFeed } from '@/components/gallery/explore-feed';
import { toPublicCreation } from '@/components/gallery/public-creation';
import { I18nProvider } from '@/lib/i18n/client';
import { newId } from '@/lib/id';
import { assetDTO, generationDTO } from '../generations/support';

// What a crawler, or a browser before its scripts run, receives from the server.
function serverHtml(names: string[], locale: 'en' | 'ar' = 'en') {
  const generations = names.map((name, index) =>
    generationDTO({
      id: newId('gen', Date.now() - index * 1000),
      prompt: `Shared prompt ${index + 1}`,
      owner: { name },
      outputs: [assetDTO({ id: newId('ast') })],
    }),
  );
  const html = renderToString(
    <I18nProvider locale={locale}>
      <ExploreFeed
        kind="all"
        initialItems={generations.map(toPublicCreation)}
        initialCursor="next"
        createHref="/studio"
        createLabel="Create your own"
      />
    </I18nProvider>,
  );
  return { html, generations };
}

describe('the Explore feed rendered on the server', () => {
  it('contains every card, with a link to its share page and the owner’s first name', () => {
    const { html, generations } = serverHtml(['Layla Hassan', 'Omar Khalid']);
    for (const [index, generation] of generations.entries()) {
      expect(html).toContain(`href="/s/${generation.id}"`);
      expect(html).toContain(`Shared prompt ${index + 1}`);
    }
    expect(html).toContain('Layla');
    expect(html).toContain('Omar');
  });

  it('leaves out everything but first names, whatever the account name holds', () => {
    const { html } = serverHtml(['Layla Hassan', 'omar@example.com Khalid', 'secret@example.com']);
    for (const secret of ['Hassan', 'Khalid', 'omar@', 'secret@', 'example.com']) {
      expect(html, secret).not.toContain(secret);
    }
  });

  it('keeps the grid hidden until the browser has laid it out, and shows it again without scripts', () => {
    const { html } = serverHtml(['Layla Hassan']);
    expect(html).toMatch(/class="explore-feed [^"]*opacity-0/);
    expect(html).toContain('<noscript>');
    expect(html).toContain('.explore-feed{opacity:1!important');
  });

  it('offers "Load more" for the second page', () => {
    expect(serverHtml(['Layla Hassan']).html).toContain('Load more');
  });

  it('renders in Arabic', () => {
    const { html } = serverHtml(['Layla Hassan'], 'ar');
    expect(html).toContain('بواسطة');
    expect(html).toContain('تحميل المزيد');
  });
});
