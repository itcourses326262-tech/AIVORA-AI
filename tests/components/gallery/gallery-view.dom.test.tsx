import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNavSnapshot, saveNavSnapshot } from '@/components/gallery/nav-snapshot';
import { newId } from '@/lib/id';
import { axeViolations } from '../axe';
import { assetDTO } from '../generations/support';
import {
  creations,
  failure,
  generationDTO,
  json,
  listCalls,
  mountGallery,
  resetEnvironment,
  router,
  shownPrompts,
  type GalleryApi,
} from './support';

vi.mock('next/navigation', async () => {
  const { router } = await import('./router');
  return { useRouter: () => router, usePathname: () => '/gallery' };
});

vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(resetEnvironment);

const user = () => userEvent.setup();

async function loaded() {
  await waitFor(() => {
    if (screen.queryByText('Loading your creations')) throw new Error('still loading');
  });
}

/**
 * Pages by keyset like the server does: "what comes after the last one I saw", so deleting what was
 * already shown never shifts the next page (the fake's own cursor is a position in the current list).
 */
function keysetListing(api: GalleryApi) {
  const order = api.generations.map((generation) => generation.id);
  api.override((call) => {
    if (call.method !== 'GET' || !call.path.startsWith('/generations?')) return undefined;
    const { searchParams } = new URL(call.path, 'http://localhost');
    if (searchParams.has('ids')) return undefined;
    const after = searchParams.get('cursor');
    const limit = Number(searchParams.get('limit') ?? 24);
    const start = after === null ? -1 : order.indexOf(after);
    const rest = api.generations.filter((generation) => order.indexOf(generation.id) > start);
    const data = rest.slice(0, limit);
    return json({ data, nextCursor: rest.length > limit ? (data.at(-1)?.id ?? null) : null });
  });
}

describe('the list', () => {
  it('loads the first page of 24 and shows each creation as a card with a link to its page', async () => {
    const { api } = mountGallery({ generations: creations(3) });
    await loaded();
    expect(listCalls(api)[0]?.path).toContain('limit=24');
    expect(shownPrompts()).toEqual(['Creation number 1', 'Creation number 2', 'Creation number 3']);
    expect(screen.getByText('Showing 3 creations')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Creation number 1' });
    expect(link).toHaveAttribute('href', `/gallery/${api.generations[0]?.id}`);
  });

  it('shows skeletons while the first page loads', () => {
    mountGallery({ generations: creations(2) });
    expect(screen.getByText('Loading your creations')).toBeInTheDocument();
  });

  it('opens the detail page on the result of the card that was clicked', async () => {
    const generations = creations(1, () => ({
      params: { aspectRatio: '1:1', count: 2 },
      outputs: [assetDTO({ id: newId('ast') }), assetDTO({ id: newId('ast') })],
    }));
    mountGallery({ generations });
    await loaded();
    const tiles = within(screen.getByRole('article')).getAllByRole('button', {
      name: /View larger/,
    });
    await user().click(tiles[1] as HTMLElement);
    expect(router.push).toHaveBeenCalledWith(`/gallery/${generations[0]?.id}?r=2`);
  });

  it('opens the detail page when a result is clicked, and remembers the list for previous / next', async () => {
    const generations = creations(3);
    mountGallery({ generations });
    await loaded();
    const [firstCard] = screen.getAllByRole('article');
    await user().click(
      within(firstCard as HTMLElement).getByRole('button', { name: /View larger/ }),
    );
    expect(router.push).toHaveBeenCalledWith(`/gallery/${generations[0]?.id}`);
    const saved = JSON.parse(window.sessionStorage.getItem('aivore.gallery.nav.v1') ?? '{}');
    expect(saved).toMatchObject({
      from: '/gallery',
      ids: generations.map((generation) => generation.id),
      restore: true,
    });
  });

  it('scrolls back to where the person was when they come back from a detail page, once', async () => {
    const generations = creations(3);
    saveNavSnapshot({
      from: '/gallery',
      ids: generations.map((generation) => generation.id),
      scrollY: 640,
      restore: true,
    });
    // jsdom has no layout: give the page a height, or the saved position lies beyond its end.
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(5000);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    mountGallery({ generations });
    await loaded();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'instant' }));
    expect(readNavSnapshot()?.restore).toBe(false);
  });

  it('starts at the top when the saved position belongs to another list', async () => {
    saveNavSnapshot({ from: '/gallery?kind=video', ids: [], scrollY: 640, restore: true });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    mountGallery({ generations: creations(3) });
    await loaded();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('sends Reuse settings to the studio with the prompt and model', async () => {
    const generations = creations(1, () => ({ prompt: 'A cat on a roof' }));
    mountGallery({ generations });
    await loaded();
    const card = screen.getByRole('article');
    await user().click(within(card).getByRole('button', { name: 'More actions' }));
    await user().click(await screen.findByRole('menuitem', { name: 'Reuse settings' }));
    const target = new URL(router.push.mock.calls[0]?.[0] as string, 'http://x');
    expect(target.pathname).toBe('/studio');
    expect(target.searchParams.get('prompt')).toBe('A cat on a roof');
    expect(target.searchParams.get('model')).toBe('aivore-demo-image');
  });

  it('has no accessibility violations', async () => {
    const { view } = mountGallery({ generations: creations(3, (i) => ({ isFavorite: i === 0 })) });
    await loaded();
    expect(await axeViolations(view.container)).toEqual([]);
  });

  it('has no accessibility violations in Arabic', async () => {
    const { view } = mountGallery({ generations: creations(3), locale: 'ar' });
    await waitFor(() => expect(document.querySelectorAll('article')).toHaveLength(3));
    expect(await axeViolations(view.container)).toEqual([]);
  });
});

describe('paging', () => {
  it('loads the next page by cursor when asked, and stops offering more at the end', async () => {
    const { api } = mountGallery({ generations: creations(30) });
    await loaded();
    expect(shownPrompts()).toHaveLength(24);
    expect(screen.getByText('Showing 24 creations')).toBeInTheDocument();

    await user().click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(shownPrompts()).toHaveLength(30));
    expect(listCalls(api)[1]?.path).toContain('cursor=24');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(new Set(shownPrompts()).size).toBe(30);
  });

  it('keeps what is on screen and offers a retry when the next page fails', async () => {
    const { api } = mountGallery({ generations: creations(30) });
    await loaded();
    let fail = true;
    api.override((call) => {
      if (!fail || !call.path.includes('cursor=24')) return undefined;
      fail = false;
      return failure(500, 'internal');
    });
    await user().click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('We could not load more creations')).toBeInTheDocument();
    expect(shownPrompts()).toHaveLength(24);
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(shownPrompts()).toHaveLength(30));
  });
});

describe('when everything loaded is gone but the server has more', () => {
  async function deleteAllShown() {
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Select' }));
    await u.click(screen.getByRole('button', { name: 'Select all' }));
    await u.click(screen.getByRole('button', { name: 'Delete' }));
    await u.click(
      await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Delete' }),
    );
  }

  it('fetches the next page instead of saying the gallery is empty', async () => {
    const { api } = mountGallery({ generations: creations(30), prepare: keysetListing });
    await loaded();
    expect(shownPrompts()).toHaveLength(24);

    await deleteAllShown();

    await waitFor(() => expect(shownPrompts()).toHaveLength(6));
    expect(shownPrompts()[0]).toBe('Creation number 25');
    expect(screen.queryByText('Your gallery is empty')).not.toBeInTheDocument();
    expect(listCalls(api)).toHaveLength(2);
    expect(listCalls(api)[1]?.path).toContain('cursor=');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers a retry, not the empty state, when that next page cannot be loaded', async () => {
    mountGallery({
      generations: creations(30),
      prepare: (api) => {
        let fail = true;
        // First in line, so it answers before the keyset paging does; the first page has no cursor.
        api.override((call) => {
          if (!fail || !call.path.includes('cursor=')) return undefined;
          fail = false;
          return failure(500, 'internal');
        });
        keysetListing(api);
      },
    });
    await loaded();

    await deleteAllShown();

    expect(await screen.findByText('We could not load more creations')).toBeInTheDocument();
    expect(screen.queryByText('Your gallery is empty')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing matches')).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(shownPrompts()).toHaveLength(6));
  });

  it('keeps the filtered view honest too: more matches are fetched, "nothing matches" waits', async () => {
    const generations = creations(30, () => ({ isFavorite: true }));
    mountGallery({ generations, filters: { favorite: true }, prepare: keysetListing });
    await loaded();
    await deleteAllShown();
    await waitFor(() => expect(shownPrompts()).toHaveLength(6));
    expect(screen.queryByText('Nothing matches')).not.toBeInTheDocument();
  });

  it('still says the gallery is empty once nothing is left on the server', async () => {
    const { api } = mountGallery({ generations: creations(3), prepare: keysetListing });
    await loaded();
    await deleteAllShown();
    expect(await screen.findByText('Your gallery is empty')).toBeInTheDocument();
    expect(listCalls(api)).toHaveLength(1);
  });
});

describe('filters', () => {
  it('filters by type, sends it to the server, and puts it in the address', async () => {
    const generations = [
      ...creations(2),
      generationDTO({ kind: 'video', tool: 'text-to-video', prompt: 'A moving clip' }),
    ];
    const { api } = mountGallery({ generations });
    await loaded();
    await user().click(screen.getByRole('radio', { name: 'Videos' }));
    await waitFor(() => expect(shownPrompts()).toEqual(['A moving clip']));
    expect(listCalls(api).at(-1)?.path).toContain('kind=video');
    expect(window.location.search).toBe('?kind=video');
    await user().click(screen.getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(shownPrompts()).toHaveLength(3));
    expect(window.location.search).toBe('');
  });

  it('filters by status', async () => {
    const generations = [
      ...creations(2),
      generationDTO({
        status: 'failed',
        outputs: [],
        prompt: 'A broken one',
        error: { code: 'timeout', message: 'x' },
      }),
    ];
    const { api } = mountGallery({ generations });
    await loaded();
    await user().selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'failed');
    await waitFor(() => expect(shownPrompts()).toEqual(['A broken one']));
    expect(listCalls(api).at(-1)?.path).toContain('status=failed');
  });

  it('shows favorites only', async () => {
    const generations = creations(4, (i) => ({ isFavorite: i === 1 }));
    const { api } = mountGallery({ generations });
    await loaded();
    const toggle = screen.getByRole('button', { name: 'Favorites' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user().click(toggle);
    await waitFor(() => expect(shownPrompts()).toEqual(['Creation number 2']));
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(listCalls(api).at(-1)?.path).toContain('favorite=true');
  });

  it('starts from the filters in the address', async () => {
    const generations = [
      ...creations(2),
      generationDTO({ kind: 'video', tool: 'text-to-video', prompt: 'Only clip' }),
    ];
    const { api } = mountGallery({ generations, filters: { kind: 'video' } });
    await loaded();
    expect(listCalls(api)[0]?.path).toContain('kind=video');
    expect(shownPrompts()).toEqual(['Only clip']);
    expect(screen.getByRole('radio', { name: 'Videos' })).toBeChecked();
  });

  it('clears every filter with one button', async () => {
    const { api } = mountGallery({
      generations: creations(3, () => ({ isFavorite: true })),
      filters: { kind: 'image', favorite: true },
    });
    await loaded();
    await user().click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(listCalls(api).length).toBeGreaterThan(1));
    expect(listCalls(api).at(-1)?.path).not.toContain('kind=');
    expect(listCalls(api).at(-1)?.path).not.toContain('favorite=');
  });
});

describe('search', () => {
  it('waits for a pause in typing, then sends one request with the whole text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = mountGallery({
      generations: creations(5, (i) => ({ prompt: i === 3 ? 'Red lighthouse' : `Other ${i}` })),
    });
    const typist = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await waitFor(() => expect(shownPrompts()).toHaveLength(5));
    const before = listCalls(api).length;

    await typist.type(screen.getByRole('textbox', { name: 'Search your creations' }), 'light');
    expect(listCalls(api)).toHaveLength(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await waitFor(() => expect(shownPrompts()).toEqual(['Red lighthouse']));
    expect(listCalls(api)).toHaveLength(before + 1);
    expect(listCalls(api).at(-1)?.path).toContain('q=light');
    expect(window.location.search).toBe('?q=light');
  });

  it('searches at once on Enter and clears with the X button', async () => {
    const { api } = mountGallery({
      generations: creations(4, (i) => ({ prompt: i === 0 ? 'Sunset' : 'Dawn' })),
    });
    await loaded();
    const box = screen.getByRole('textbox', { name: 'Search your creations' });
    await user().type(box, 'sunset{Enter}');
    await waitFor(() => expect(shownPrompts()).toEqual(['Sunset']));
    expect(listCalls(api).at(-1)?.path).toContain('q=sunset');
    await user().click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(shownPrompts()).toHaveLength(4));
    expect(box).toHaveValue('');
  });

  it('finds Arabic text and sends it normalized', async () => {
    const { api } = mountGallery({
      generations: creations(3, (i) => ({
        prompt: i === 1 ? 'غابة سحرية عند الفجر' : 'something else',
      })),
      locale: 'ar',
    });
    await waitFor(() => expect(shownPrompts()).toHaveLength(3));
    const box = screen.getByRole('textbox', { name: 'ابحث في أعمالك' });
    await user().type(box, '\u200fغابة  سحرية{Enter}');
    await waitFor(() => expect(shownPrompts()).toEqual(['غابة سحرية عند الفجر']));
    const sent = new URL(listCalls(api).at(-1)?.path ?? '', 'http://x').searchParams.get('q');
    expect(sent).toBe('غابة سحرية');
  });
});

describe('empty and error states', () => {
  it('invites a person with no creations to the studio', async () => {
    mountGallery({ generations: [] });
    expect(
      await screen.findByRole('heading', { name: 'Your gallery is empty' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create something' })).toHaveAttribute(
      'href',
      '/studio',
    );
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
  });

  it('says that nothing matches, not that the gallery is empty, when filters find nothing', async () => {
    mountGallery({ generations: creations(2), filters: { q: 'zebra' } });
    expect(await screen.findByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Your gallery is empty' }),
    ).not.toBeInTheDocument();
    await user().click(
      screen.getAllByRole('button', { name: 'Clear filters' }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(shownPrompts()).toHaveLength(2));
  });

  it('shows the error and retries the first page', async () => {
    let failing = true;
    mountGallery({
      generations: creations(2),
      prepare: (api) =>
        api.override((call) => {
          if (!failing || call.method !== 'GET' || !call.path.startsWith('/generations?')) {
            return undefined;
          }
          failing = false;
          return failure(503, 'service_busy');
        }),
    });
    expect(await screen.findByText('We could not load your creations')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(shownPrompts()).toHaveLength(2));
    expect(screen.queryByText('We could not load your creations')).not.toBeInTheDocument();
  });
});

describe('live updates', () => {
  it('updates a creation that is still being made until it is finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = generationDTO({
      id: 'gen_01m4ez7hbzhastjgh71jn97pyk',
      status: 'processing',
      progress: 40,
      outputs: [],
      prompt: 'Still cooking',
    });
    const { api } = mountGallery({ generations: [running] });
    await waitFor(() =>
      expect(screen.getByRole('article')).toHaveAttribute('data-status', 'processing'),
    );

    api.generations[0] = {
      ...running,
      status: 'succeeded',
      progress: 100,
      outputs: [creations(1)[0]!.outputs[0]!],
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() =>
      expect(screen.getByRole('article')).toHaveAttribute('data-status', 'succeeded'),
    );
    expect(api.callsTo('GET', '/generations?ids=').length).toBeGreaterThan(0);
  });

  it('drops a creation that was deleted elsewhere', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = generationDTO({
      id: 'gen_01m4ez7hbzhastjgh71jn97pyk',
      status: 'queued',
      progress: 0,
      outputs: [],
    });
    const { api } = mountGallery({ generations: [running, ...creations(1)] });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    api.generations = api.generations.filter((generation) => generation.id !== running.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
  });
});

describe('selecting several', () => {
  async function enterSelection() {
    await loaded();
    await user().click(screen.getByRole('button', { name: 'Select' }));
  }
  const choose = (n: number) =>
    screen.getByRole('button', { name: new RegExp(`^Select: Creation number ${n}$`) });

  it('turns the cards into switches and counts what is chosen', async () => {
    mountGallery({ generations: creations(4) });
    await enterSelection();
    expect(screen.getByText('Choose creations to act on them')).toBeInTheDocument();
    await user().click(choose(1));
    await user().click(choose(3));
    expect(choose(1)).toHaveAttribute('aria-pressed', 'true');
    expect(choose(2)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    // The cards' own buttons are out of reach while choosing (the card is inert).
    for (const card of screen.getAllByRole('article'))
      expect(card.closest('[inert]')).not.toBeNull();
  });

  it('selects a range with Shift, selects all, clears, and leaves with Escape', async () => {
    mountGallery({ generations: creations(5) });
    const u = userEvent.setup();
    await loaded();
    await u.click(screen.getByRole('button', { name: 'Select' }));
    await u.click(choose(1));
    await u.keyboard('{Shift>}');
    await u.click(choose(4));
    await u.keyboard('{/Shift}');
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('Choose creations to act on them')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('5 selected')).toBeInTheDocument();
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Selection actions' })).not.toBeInTheDocument();
  });

  it('asks before deleting, deletes every chosen creation and reports it', async () => {
    const { api } = mountGallery({ generations: creations(4) });
    await enterSelection();
    await user().click(choose(1));
    await user().click(choose(2));
    await user().click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete these 2 creations?' });
    expect(api.callsTo('DELETE', '/generations/')).toHaveLength(0);
    // The safe button has the focus.
    expect(within(dialog).getByRole('button', { name: 'Keep' })).toHaveFocus();
    await user().click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(shownPrompts()).toEqual(['Creation number 3', 'Creation number 4']));
    expect(api.callsTo('DELETE', '/generations/')).toHaveLength(2);
    expect(await screen.findByText('2 creations deleted.')).toBeInTheDocument();
  });

  it('does not delete anything when the question is declined', async () => {
    const { api } = mountGallery({ generations: creations(2) });
    await enterSelection();
    await user().click(choose(1));
    await user().click(screen.getByRole('button', { name: 'Delete' }));
    await user().click(await screen.findByRole('button', { name: 'Keep' }));
    expect(api.callsTo('DELETE', '/generations/')).toHaveLength(0);
    expect(shownPrompts()).toHaveLength(2);
  });

  it('keeps the ones that could not be deleted chosen, and says so', async () => {
    const generations = creations(3);
    const { api } = mountGallery({ generations });
    api.override((call) =>
      call.method === 'DELETE' && call.path.endsWith(generations[1]?.id ?? '')
        ? failure(500, 'internal')
        : undefined,
    );
    await enterSelection();
    await user().click(screen.getByRole('button', { name: 'Select all' }));
    await user().click(screen.getByRole('button', { name: 'Delete' }));
    await user().click(
      await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Delete' }),
    );
    expect(
      await screen.findByText('2 of 3 deleted. The rest could not be removed.'),
    ).toBeInTheDocument();
    expect(shownPrompts()).toEqual(['Creation number 2']);
    expect(choose(2)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('adds the chosen creations to favorites, and removes them when they all are favorites', async () => {
    const { api } = mountGallery({ generations: creations(3) });
    await enterSelection();
    await user().click(choose(1));
    await user().click(choose(2));
    await user().click(screen.getByRole('button', { name: 'Add to favorites' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/generations/')).toHaveLength(2));
    expect(
      api
        .callsTo('PATCH', '/generations/')
        .every((call) => (call.body as { isFavorite: boolean }).isFavorite),
    ).toBe(true);
    expect(await screen.findByText('2 creations added to favorites.')).toBeInTheDocument();

    // A finished run leaves the mode on and the selection empty: choose them again to undo.
    await user().click(choose(1));
    await user().click(choose(2));
    await user().click(await screen.findByRole('button', { name: 'Remove from favorites' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/generations/')).toHaveLength(4));
    expect(api.callsTo('PATCH', '/generations/').at(-1)?.body).toEqual({ isFavorite: false });
  });

  it('only favorites finished creations', async () => {
    const running = generationDTO({
      status: 'processing',
      outputs: [],
      progress: 20,
      prompt: 'Cooking',
    });
    const { api } = mountGallery({ generations: [running] });
    await enterSelection();
    await user().click(screen.getByRole('button', { name: /^Select: Cooking$/ }));
    expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeDisabled();
    expect(api.callsTo('PATCH', '/generations/')).toHaveLength(0);
  });
});
