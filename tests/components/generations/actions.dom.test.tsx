import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationCard, GenerationConfirm } from '@/components/generations';
import { Toaster, toast } from '@/components/ui/toast';
import type { GenerationDTO } from '@/lib/api-types';
import { useGenerationActions } from '@/lib/generations/use-generation-actions';
import { UserProvider } from '@/lib/user-context';
import { renderUi } from '../render';
import {
  USER,
  apiError,
  assetDTO,
  generationDTO,
  installFakeApi,
  json,
  type FakeApi,
} from './support';

function List({ initial }: { initial: GenerationDTO[] }) {
  const [items, setItems] = useState(initial);
  const actions = useGenerationActions({
    onChange: (next) => setItems((all) => all.map((item) => (item.id === next.id ? next : item))),
    onRemove: (gone) => setItems((all) => all.filter((item) => item.id !== gone.id)),
  });
  return (
    <>
      {items.map((generation) => (
        <GenerationCard key={generation.id} generation={generation} handlers={actions.handlers} />
      ))}
      <GenerationConfirm
        confirmation={actions.confirmation}
        onConfirm={actions.confirm}
        onDismiss={actions.dismiss}
      />
    </>
  );
}

/** A list whose copies are kept up to date from outside, the way polling keeps the studio's. */
function Watched({ items }: { items: GenerationDTO[] }) {
  const actions = useGenerationActions({
    generations: items,
    onChange: () => undefined,
    onRemove: () => undefined,
  });
  return (
    <>
      {items.map((generation) => (
        <GenerationCard key={generation.id} generation={generation} handlers={actions.handlers} />
      ))}
      <GenerationConfirm
        confirmation={actions.confirmation}
        onConfirm={actions.confirm}
        onDismiss={actions.dismiss}
      />
    </>
  );
}

let api: FakeApi;

function mount(generations: GenerationDTO[]) {
  api.generations = generations;
  return renderUi(
    <UserProvider initialUser={USER}>
      <Toaster />
      <List initial={generations} />
    </UserProvider>,
  );
}

beforeEach(() => {
  api = installFakeApi();
});

afterEach(() => {
  toast.dismissAll();
  vi.unstubAllGlobals();
});

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: item }));
}

describe('favorite', () => {
  it('shows the change at once, saves it, and keeps it', async () => {
    const generation = generationDTO();
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(api.callsTo('PATCH', `/generations/${generation.id}`)[0]?.body).toEqual({
        isFavorite: true,
      }),
    );
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('undoes the change and says so when saving fails', async () => {
    const generation = generationDTO({ isFavorite: true });
    api.intercept((call) => (call.method === 'PATCH' ? apiError(500, 'internal') : undefined));
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Favorite' }));
    await screen.findByText('We could not update this creation.');
    expect(
      screen.getByText('Something went wrong on our side. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sends one request however fast it is clicked', async () => {
    const generation = generationDTO();
    let release: (() => void) | undefined;
    api.intercept(async (call) => {
      if (call.method !== 'PATCH') return undefined;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return undefined;
    });
    const user = userEvent.setup();
    mount([generation]);
    const heart = screen.getByRole('button', { name: 'Favorite' });
    await user.click(heart);
    await user.click(heart);
    await user.click(heart);
    release?.();
    await waitFor(() => expect(api.callsTo('PATCH', '/generations/')).toHaveLength(1));
  });
});

describe('sharing', () => {
  it('turns sharing on, tells the user and offers to copy the public link', async () => {
    const generation = generationDTO();
    const user = userEvent.setup();
    mount([generation]);
    await choose(user, 'Share to Explore');
    await waitFor(() =>
      expect(api.callsTo('PATCH', `/generations/${generation.id}`)[0]?.body).toEqual({
        isPublic: true,
      }),
    );
    expect(
      await screen.findByText('Shared to Explore. The link is ready to copy.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/s/${generation.id}`,
    );
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
  });

  it('copies the link from the menu of a shared generation', async () => {
    const generation = generationDTO({ isPublic: true });
    const user = userEvent.setup();
    mount([generation]);
    await choose(user, 'Copy link');
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/s/${generation.id}`,
    );
  });

  it('warns when the browser refuses to copy', async () => {
    const generation = generationDTO({ isPublic: true });
    const user = userEvent.setup();
    mount([generation]);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await choose(user, 'Copy link');
    expect(await screen.findByText(/We could not copy the link/)).toBeInTheDocument();
  });

  it('turns sharing off again', async () => {
    const generation = generationDTO({ isPublic: true });
    const user = userEvent.setup();
    mount([generation]);
    await choose(user, 'Stop sharing');
    expect(await screen.findByText('Sharing is off.')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
  });
});

describe('cancel', () => {
  it('cancels a queued generation at once, without asking, and refreshes the balance', async () => {
    const generation = generationDTO({ status: 'queued', progress: 0, outputs: [] });
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(api.callsTo('POST', `/generations/${generation.id}/cancel`)).toHaveLength(1),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      await screen.findByText('Generation canceled. Your credits were refunded.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('article')).toHaveAttribute('data-status', 'canceled'),
    );
    expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);
  });

  it('asks before canceling a running one, with the safe answer focused', async () => {
    const generation = generationDTO({ status: 'processing', progress: 40, outputs: [] });
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this generation?' });
    expect(within(dialog).getByText(/refunded in full/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep going' })).toHaveFocus();
    expect(api.callsTo('POST', '/generations/')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Keep going' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.callsTo('POST', '/generations/')).toHaveLength(0);
    expect(screen.getByRole('article')).toHaveAttribute('data-status', 'processing');
  });

  it('cancels after the user confirms, and closes the dialog', async () => {
    const generation = generationDTO({ status: 'processing', progress: 40, outputs: [] });
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel generation' }));
    await waitFor(() =>
      expect(api.callsTo('POST', `/generations/${generation.id}/cancel`)).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('article')).toHaveAttribute('data-status', 'canceled');
  });

  it('reports a cancel that the server refuses without a reason it can confirm', async () => {
    const generation = generationDTO({ status: 'processing', progress: 99, outputs: [] });
    api.intercept((call) =>
      call.path.endsWith('/cancel') ? apiError(409, 'conflict') : undefined,
    );
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel generation' }));
    expect(await screen.findByText('We could not update this creation.')).toBeInTheDocument();
    expect(screen.getByText(/conflicts with the current state/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // The server still says it is running: the card is left as it was.
    expect(screen.getByRole('article')).toHaveAttribute('data-status', 'processing');
  });

  it('shows how a generation ended when it finished while the question was open', async () => {
    const generation = generationDTO({ status: 'processing', progress: 99, outputs: [] });
    const user = userEvent.setup();
    mount([generation]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirmButton = await screen.findByRole('button', { name: 'Cancel generation' });
    // The video completes behind the dialog; the server refuses the cancel as too late.
    api.generations[0] = {
      ...generation,
      status: 'succeeded',
      progress: 100,
      outputs: [assetDTO()],
    };
    api.intercept((call) =>
      call.path.endsWith('/cancel')
        ? apiError(409, 'conflict', { status: 'succeeded' })
        : undefined,
    );
    await user.click(confirmButton);

    expect(
      await screen.findByText('It had already finished, so it could not be canceled.'),
    ).toBeInTheDocument();
    // No "refresh the page" error, and the card shows the result instead of a stale progress bar.
    // (A toast of the previous test may still be fading out, so give it the time to go.)
    await waitFor(() =>
      expect(screen.queryByText('We could not update this creation.')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('article')).toHaveAttribute('data-status', 'succeeded'),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('closes the cancel question by itself when the generation finishes behind it', async () => {
    const running = generationDTO({ status: 'processing', progress: 80, outputs: [] });
    const user = userEvent.setup();
    const view = renderUi(
      <UserProvider initialUser={USER}>
        <Toaster />
        <Watched items={[running]} />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Cancel this generation?' }),
    ).toBeInTheDocument();

    const done = { ...running, status: 'succeeded' as const, progress: 100, outputs: [assetDTO()] };
    view.rerender(
      <UserProvider initialUser={USER}>
        <Toaster />
        <Watched items={[done]} />
      </UserProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // Nothing was sent: there was nothing left to cancel.
    expect(api.callsTo('POST', '/generations/')).toHaveLength(0);
  });

  it('keeps asking about a delete when the generation finishes, with the text that fits how it stands now', async () => {
    const running = generationDTO({ status: 'processing', progress: 80, outputs: [] });
    const user = userEvent.setup();
    const tree = (items: GenerationDTO[]) => (
      <UserProvider initialUser={USER}>
        <Toaster />
        <Watched items={items} />
      </UserProvider>
    );
    const view = renderUi(tree([running]));
    await choose(user, 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/canceled, your credits refunded/)).toBeInTheDocument();

    view.rerender(
      tree([{ ...running, status: 'succeeded', progress: 100, outputs: [assetDTO()] }]),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('alertdialog')).getByText(/removed for good/),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('alertdialog')).queryByText(/canceled, your credits/),
    ).toBeNull();
  });

  it('forgets the question for good once its generation has left the list', async () => {
    const running = generationDTO({ status: 'processing', progress: 80, outputs: [] });
    const user = userEvent.setup();
    const tree = (items: GenerationDTO[]) => (
      <UserProvider initialUser={USER}>
        <Toaster />
        <Watched items={items} />
      </UserProvider>
    );
    const view = renderUi(tree([running]));
    await choose(user, 'Delete');
    await screen.findByRole('alertdialog');
    view.rerender(tree([]));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // It does not come back when the same generation shows up in the list again.
    await act(async () => view.rerender(tree([running])));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('delete', () => {
  it('asks first, keeps the card on "Keep" and removes it on "Delete"', async () => {
    const generation = generationDTO();
    const user = userEvent.setup();
    mount([generation]);
    await choose(user, 'Delete');
    let dialog = await screen.findByRole('alertdialog', { name: 'Delete this creation?' });
    expect(within(dialog).getByText(/removed for good/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.callsTo('DELETE', '/generations/')).toHaveLength(0);
    expect(screen.getByRole('article')).toBeInTheDocument();

    await choose(user, 'Delete');
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(api.callsTo('DELETE', `/generations/${generation.id}`)).toHaveLength(1);
    expect(await screen.findByText('Deleted.')).toBeInTheDocument();
    // A finished generation moved no credits.
    expect(api.callsTo('GET', '/auth/me')).toHaveLength(0);
  });

  it('says a running generation is canceled and refunded first, and refreshes the balance', async () => {
    const generation = generationDTO({ status: 'processing', progress: 30, outputs: [] });
    const user = userEvent.setup();
    mount([generation]);
    await choose(user, 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/canceled, your credits refunded/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);
  });

  it('keeps the card and says so when the server cannot delete it', async () => {
    const generation = generationDTO();
    api.intercept((call) =>
      call.method === 'DELETE'
        ? json({ error: { code: 'not_found', message: 'x' } }, 404)
        : undefined,
    );
    const user = userEvent.setup();
    mount([generation]);
    await choose(user, 'Delete');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('We could not update this creation.')).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
