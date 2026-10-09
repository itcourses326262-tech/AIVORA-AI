import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExploreCard, estimateExploreHeight } from '@/components/gallery/explore-card';
import { ExploreFeed } from '@/components/gallery/explore-feed';
import { ExploreKindNav } from '@/components/gallery/explore-kind-nav';
import { toPublicCreation, type PublicCreation } from '@/components/gallery/public-creation';
import type { GenerationDTO } from '@/lib/api-types';
import { newId } from '@/lib/id';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { assetDTO, generationDTO, json } from '../generations/support';
import { failure } from './support';

vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = (name: string) => ({ owner: { name } });

function shared(count: number, make: (index: number) => Partial<GenerationDTO> = () => ({})) {
  const base = Date.now() - 60_000;
  return Array.from({ length: count }, (_, index) =>
    generationDTO({
      id: newId('gen', base - index * 1000),
      prompt: `Shared prompt ${index + 1}`,
      isPublic: true,
      outputs: [assetDTO({ id: newId('ast'), width: 1024, height: 1024 })],
      ...owner('Layla Hassan'),
      ...make(index),
    }),
  );
}

const creations = (generations: GenerationDTO[]): PublicCreation[] =>
  generations.map(toPublicCreation);

describe('ExploreCard', () => {
  it('shows the prompt as the one link to the share page, the model and the owner’s first name', () => {
    const [generation] = shared(1, () => ({ ...owner('Layla Hassan') }));
    renderUi(<ExploreCard creation={toPublicCreation(generation as GenerationDTO)} />);
    const link = screen.getByRole('link', { name: 'Shared prompt 1' });
    expect(link).toHaveAttribute('href', `/s/${generation?.id}`);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('AIVORE Demo Image')).toBeInTheDocument();
    expect(screen.getByText('Layla')).toBeInTheDocument();
    expect(screen.getByText(/^by/)).toBeInTheDocument();
  });

  it('never shows more than the first name, and never an email', () => {
    const generations = shared(3, (index) => ({
      ...owner(['Layla Hassan', 'omar@example.com', 'omar@example.com Khalid'][index] as string),
    }));
    const { container } = renderUi(
      <>
        {creations(generations).map((creation) => (
          <ExploreCard key={creation.id} creation={creation} />
        ))}
      </>,
    );
    const html = container.innerHTML;
    expect(html).toContain('Layla');
    for (const secret of ['Hassan', 'omar@', 'example.com', 'Khalid', '@']) {
      expect(html, secret).not.toContain(secret);
    }
    // Two of the three had no usable name: only one byline.
    expect(screen.getAllByText(/^by/)).toHaveLength(1);
  });

  it('labels a video with its duration and a still picture with nothing', () => {
    const [video] = shared(1, () => ({
      kind: 'video',
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      outputs: [assetDTO({ kind: 'video', mimeType: 'video/mp4', durationMs: 5000 })],
    }));
    const [still] = shared(1);
    const first = renderUi(<ExploreCard creation={toPublicCreation(video as GenerationDTO)} />);
    expect(first.container.textContent).toContain('5 sec');
    first.unmount();
    const second = renderUi(<ExploreCard creation={toPublicCreation(still as GenerationDTO)} />);
    expect(second.container.textContent).not.toContain('sec');
  });

  it('speaks Arabic', () => {
    const [generation] = shared(1);
    renderUi(<ExploreCard creation={toPublicCreation(generation as GenerationDTO)} />, {
      locale: 'ar',
    });
    expect(screen.getByText('بواسطة')).toBeInTheDocument();
  });

  it('estimates its height from the picture’s shape', () => {
    const wide = { ...creations(shared(1))[0], outputs: [assetDTO({ width: 2000, height: 1000 })] };
    const tall = { ...creations(shared(1))[0], outputs: [assetDTO({ width: 1000, height: 2000 })] };
    expect(estimateExploreHeight(wide as PublicCreation, 300)).toBeLessThan(
      estimateExploreHeight(tall as PublicCreation, 300),
    );
    // A sliver or a tower is boxed, so one odd picture cannot dominate a column.
    const tower = { ...tall, outputs: [assetDTO({ width: 100, height: 4000 })] };
    expect(estimateExploreHeight(tower as PublicCreation, 300)).toBeLessThanOrEqual(300 / 0.5 + 96);
  });
});

describe('ExploreKindNav', () => {
  it('is a list of links, one per kind, with the current one marked', () => {
    renderUi(<ExploreKindNav kind="video" />);
    const nav = screen.getByRole('navigation', { name: 'Type' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['All', '/explore'],
      ['Images', '/explore?kind=image'],
      ['Videos', '/explore?kind=video'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Videos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
  });
});

function feedResponse(items: GenerationDTO[], nextCursor: string | null) {
  return json({ data: items, nextCursor });
}

describe('ExploreFeed', () => {
  const feed = (props: Partial<Parameters<typeof ExploreFeed>[0]> = {}) => (
    <ExploreFeed
      kind="all"
      initialItems={creations(shared(3))}
      initialCursor={null}
      createHref="/studio"
      createLabel="Create your own"
      {...props}
    />
  );

  it('shows the first page it was given, newest first, without asking the server', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderUi(feed());
    expect(
      screen.getAllByRole('article').map((card) => card.querySelector('h2')?.textContent),
    ).toEqual(['Shared prompt 1', 'Shared prompt 2', 'Shared prompt 3']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('loads the next page by cursor, appends it, and stops at the last page', async () => {
    const second = shared(2, (i) => ({ prompt: `Second page ${i + 1}` }));
    const fetchMock = vi.fn(async () => feedResponse(second, null));
    vi.stubGlobal('fetch', fetchMock);
    renderUi(feed({ initialCursor: 'cursor-1' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5));
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const requested = new URL(url, 'http://x');
    expect(requested.pathname).toBe('/api/v1/explore');
    expect(requested.searchParams.get('cursor')).toBe('cursor-1');
    expect(requested.searchParams.get('limit')).toBe('24');
    expect(requested.searchParams.has('kind')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('asks for the kind it shows', async () => {
    const fetchMock = vi.fn(async () => feedResponse([], null));
    vi.stubGlobal('fetch', fetchMock);
    renderUi(feed({ kind: 'video', initialCursor: 'c' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url, 'http://x').searchParams.get('kind')).toBe('video');
  });

  it('does not repeat a creation that two pages both returned', async () => {
    const initial = shared(2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        feedResponse([...initial.slice(1), ...shared(1, () => ({ prompt: 'Fresh' }))], null),
      ),
    );
    renderUi(feed({ initialItems: creations(initial), initialCursor: 'c' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
  });

  it('keeps only the first name of owners that arrive on later pages, and their emails never show', async () => {
    const page = shared(2, (i) => ({
      ...owner(i === 0 ? 'Omar Khalid' : 'someone@example.com'),
      prompt: `Later ${i}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => feedResponse(page, null)),
    );
    const { container } = renderUi(feed({ initialItems: [], initialCursor: 'c' }));
    // Empty first page with a cursor: the empty state is shown until the next page arrives.
    expect(screen.getByText('Nothing has been shared yet')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('Khalid');
  });

  it('drops a creation without results instead of showing a blank card', async () => {
    const page = [...shared(1), ...shared(1, () => ({ outputs: [] }))];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => feedResponse(page, null)),
    );
    renderUi(feed({ initialCursor: 'c' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(4));
  });

  it('says the next page failed, keeps what is shown and tries again', async () => {
    const answers = [
      failure(503, 'service_busy'),
      feedResponse(
        shared(1, () => ({ prompt: 'Recovered' })),
        null,
      ),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answers.shift() as Response),
    );
    renderUi(feed({ initialCursor: 'c' }));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('We could not load more creations')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    await u.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(4));
    expect(screen.queryByText('We could not load more creations')).not.toBeInTheDocument();
  });

  it('invites people to make something when nothing has been shared yet', () => {
    renderUi(feed({ initialItems: [], createHref: '/register?next=%2Fstudio' }));
    expect(
      screen.getByRole('heading', { name: 'Nothing has been shared yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your own' })).toHaveAttribute(
      'href',
      '/register?next=%2Fstudio',
    );
  });

  it.each([
    ['video', 'No videos have been shared yet'],
    ['image', 'No images have been shared yet'],
  ] as const)(
    'does not claim that nothing was shared when only the %s filter is empty',
    (kind, title) => {
      renderUi(feed({ kind, initialItems: [] }));
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.queryByText('Nothing has been shared yet')).not.toBeInTheDocument();
      // Everything is one click away, and the invitation to make something stays.
      expect(screen.getByRole('link', { name: 'See all creations' })).toHaveAttribute(
        'href',
        '/explore',
      );
      expect(screen.getByRole('link', { name: 'Create your own' })).toHaveAttribute(
        'href',
        '/studio',
      );
    },
  );

  it('says so in Arabic too, with the filter named', () => {
    renderUi(feed({ kind: 'video', initialItems: [] }), { locale: 'ar' });
    expect(screen.getByRole('heading', { name: 'لم تُشارَك فيديوهات بعد' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'عرض كل الأعمال' })).toHaveAttribute(
      'href',
      '/explore',
    );
  });

  it('has no accessibility violations, in English and in Arabic', async () => {
    const en = renderUi(feed({ initialCursor: 'c' }));
    expect(await axeViolations(en.container)).toEqual([]);
    en.unmount();
    const ar = renderUi(feed(), { locale: 'ar' });
    expect(await axeViolations(ar.container)).toEqual([]);
  });
});
