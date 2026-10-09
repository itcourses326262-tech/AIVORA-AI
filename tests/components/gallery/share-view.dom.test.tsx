import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remixHref } from '@/components/gallery/links';
import { toPublicCreation, type PublicCreation } from '@/components/gallery/public-creation';
import { ShareView, type ShareViewProps } from '@/components/gallery/share-view';
import { toast } from '@/components/ui/toast';
import { createTranslator } from '@/lib/i18n';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { assetDTO, generationDTO } from '../generations/support';

vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  toast.dismissAll();
  vi.unstubAllGlobals();
});

const ORIGIN = 'https://aivore.example';

const image = (extra = {}): PublicCreation =>
  toPublicCreation(
    generationDTO({
      id: 'gen_01hzzzzzzzzzzzzzzzzzzzzzzz',
      prompt: 'A lone lighthouse at sunset',
      params: { aspectRatio: '16:9', count: 1, seed: 99 },
      owner: { name: 'Layla Hassan' },
      cost: 7,
      outputs: [assetDTO({ id: 'ast_one', width: 1280, height: 720 })],
      createdAt: Date.parse('2026-10-08T10:00:00Z'),
      ...extra,
    }),
  );

function view(
  creation: PublicCreation,
  props: Partial<ShareViewProps> = {},
  locale: 'en' | 'ar' = 'en',
) {
  return renderUi(
    <ShareView
      creation={creation}
      origin={ORIGIN}
      signedIn={false}
      i18n={createTranslator(locale)}
      {...props}
    />,
    { locale },
  );
}

describe('the public share page', () => {
  it('has the prompt as its one h1, the owner’s first name and the model', () => {
    view(image());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'A lone lighthouse at sunset',
    );
    expect(screen.getByText('Layla')).toBeInTheDocument();
    expect(screen.getByText('Shared image')).toBeInTheDocument();
    expect(screen.getAllByText('AIVORE Demo Image').length).toBeGreaterThan(0);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('shows the result large, zoomable, named after the prompt', () => {
    view(image());
    const zoomable = screen.getByRole('group', { name: /A lone lighthouse at sunset/ });
    expect(zoomable.querySelector('img')).toHaveAttribute('src', '/api/v1/media/ast_one');
  });

  it('exposes nothing private: no email, no full name, no cost, no seed, no input picture', () => {
    const { container } = view(
      image({
        owner: { name: 'layla@example.com Hassan' },
        input: assetDTO({ id: 'ast_secret_input' }),
        isFavorite: true,
      }),
    );
    const html = container.innerHTML;
    for (const secret of [
      'layla@',
      'example.com',
      'Hassan',
      'ast_secret_input',
      'Seed',
      'seed',
      '99',
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    // Without a usable name there is no byline at all.
    expect(screen.queryByText(/^by/)).not.toBeInTheDocument();
  });

  it('describes how it was made: model, tool, aspect ratio, and for a video the duration and resolution', () => {
    const clip = toPublicCreation(
      generationDTO({
        kind: 'video',
        tool: 'text-to-video',
        modelId: 'aivore-demo-video',
        params: { aspectRatio: '9:16', count: 1, durationSec: 5, resolution: '480p' },
        outputs: [assetDTO({ kind: 'video', mimeType: 'video/mp4', durationMs: 5000 })],
        owner: { name: 'Omar' },
      }),
    );
    view(clip);
    const about = screen.getByRole('region', { name: 'About this creation' });
    const row = (label: string) => within(about).getByText(label).parentElement?.textContent ?? '';
    expect(row('Tool')).toContain('Text to video');
    expect(row('Aspect ratio')).toContain('9:16');
    expect(row('Duration')).toContain('5 sec');
    expect(row('Resolution')).toContain('480p');
    expect(screen.getByText('Shared video')).toBeInTheDocument();
  });

  it('never shows the negative prompt on a public page', () => {
    view(image({ negativePrompt: 'blurry, watermark' }));
    expect(screen.queryByText('Negative prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('blurry, watermark')).not.toBeInTheDocument();
  });

  it('cuts a very long prompt in the heading and gives the whole text below', () => {
    const long = 'word '.repeat(120).trim();
    view(image({ prompt: long }));
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent?.endsWith('…')).toBe(true);
    expect(heading.textContent?.length).toBeLessThan(long.length);
    expect(screen.getByRole('heading', { name: 'Prompt' })).toBeInTheDocument();
    expect(screen.getAllByText(long).length).toBe(1);
    // The whole text lives in a scrolling box: a keyboard user must be able to focus it.
    expect(screen.getByRole('region', { name: 'Prompt' })).toHaveAttribute('tabindex', '0');
  });

  it('shows a short prompt once, as the heading', () => {
    view(image());
    expect(screen.queryByRole('heading', { name: 'Prompt' })).not.toBeInTheDocument();
  });

  it('has the date as a machine-readable time element', () => {
    view(image());
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-08T10:00:00.000Z');
  });

  it('describes the creation to search engines in JSON-LD without private details', () => {
    const { container } = view(image());
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.textContent ?? '{}');
    expect(data['@type']).toBe('ImageObject');
    expect(data.contentUrl).toBe(`${ORIGIN}/api/v1/media/ast_one`);
    expect(data.creator).toEqual({ '@type': 'Person', name: 'Layla' });
    expect(script?.textContent).not.toContain('Hassan');
  });
});

describe('the ways forward', () => {
  it('sends a visitor to log in first and on to the studio with the prompt ready', () => {
    const creation = image();
    view(creation);
    const remix = screen.getByRole('link', { name: 'Remix in Studio' });
    const href = remix.getAttribute('href') as string;
    expect(href.startsWith('/login?next=')).toBe(true);
    const next = new URL(href, 'http://x').searchParams.get('next');
    expect(next).toBe(remixHref(creation));
    const studio = new URL(next as string, 'http://x');
    expect(studio.pathname).toBe('/studio');
    expect(studio.searchParams.get('prompt')).toBe('A lone lighthouse at sunset');
    expect(studio.searchParams.get('tool')).toBe('text-to-image');
    expect(screen.getByText(/You will log in or sign up first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your own' })).toHaveAttribute(
      'href',
      '/register?next=%2Fstudio',
    );
  });

  it('sends a signed-in user straight to the studio', () => {
    const creation = image();
    view(creation, { signedIn: true });
    expect(screen.getByRole('link', { name: 'Remix in Studio' })).toHaveAttribute(
      'href',
      remixHref(creation),
    );
    expect(screen.getByRole('link', { name: 'Create your own' })).toHaveAttribute(
      'href',
      '/studio',
    );
    expect(screen.queryByText(/You will log in or sign up first/)).not.toBeInTheDocument();
  });

  it('links back to Explore', () => {
    view(image());
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toHaveAttribute(
      'href',
      '/explore',
    );
  });

  it('copies the prompt and the public link', async () => {
    const u = userEvent.setup();
    view(image());
    await u.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await navigator.clipboard.readText()).toBe('A lone lighthouse at sunset');
    await u.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(`${ORIGIN}/s/gen_01hzzzzzzzzzzzzzzzzzzzzzzz`);
  });
});

describe('in Arabic', () => {
  it('speaks Arabic and keeps the user’s prompt in its own direction', () => {
    view(image({ prompt: 'غابة سحرية عند الفجر' }), {}, 'ar');
    expect(screen.getByRole('link', { name: 'جرّبه في الاستوديو' })).toBeInTheDocument();
    expect(screen.getByText('صورة مشارَكة')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('بواسطة')).toBeInTheDocument();
  });

  it('has no accessibility violations, in English and in Arabic', async () => {
    const en = view(image());
    expect(await axeViolations(en.container)).toEqual([]);
    en.unmount();
    const ar = view(image(), {}, 'ar');
    expect(await axeViolations(ar.container)).toEqual([]);
  });
});
