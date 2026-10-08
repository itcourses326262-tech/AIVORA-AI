import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaViewer } from '@/components/generations';
import type { GenerationDTO } from '@/lib/api-types';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { UserProvider } from '@/lib/user-context';
import { renderUi } from '../render';
import { axeViolations } from '../axe';
import { USER, assetDTO, generationDTO } from './support';

afterEach(() => {
  vi.restoreAllMocks();
});

const three = () =>
  generationDTO({
    prompt: 'A fluffy orange cat in a tiny astronaut helmet',
    params: { aspectRatio: '1:1', count: 3 },
    cost: 3,
    outputs: [assetDTO({ id: 'ast_a' }), assetDTO({ id: 'ast_b' }), assetDTO({ id: 'ast_c' })],
  });

/** The viewer with its index kept by a parent, like the studio does. */
function Host({
  generation,
  start = 0,
  handlers,
  onClose = vi.fn(),
  spy,
}: {
  generation: GenerationDTO | null;
  start?: number;
  handlers?: GenerationHandlers;
  onClose?: () => void;
  spy?: (index: number) => void;
}) {
  const [index, setIndex] = useState(start);
  return (
    <UserProvider initialUser={USER}>
      <MediaViewer
        generation={generation}
        index={index}
        onIndexChange={(next) => {
          spy?.(next);
          setIndex(next);
        }}
        onClose={onClose}
        handlers={handlers}
        modelLabel="AIVORE Demo Image"
      />
    </UserProvider>
  );
}

const shown = () => within(screen.getByRole('dialog')).getAllByRole('img')[0] as HTMLElement;

describe('MediaViewer', () => {
  it('renders nothing while closed', () => {
    renderUi(<Host generation={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the full-size file in a dialog named by the prompt, with the model, cost and position', () => {
    renderUi(<Host generation={three()} />);
    const dialog = screen.getByRole('dialog', { name: /A fluffy orange cat/ });
    expect(within(dialog).getByText(/AIVORE Demo Image · 3 credits/)).toBeInTheDocument();
    expect(shown()).toHaveAttribute('src', '/api/v1/media/ast_a');
    expect(shown()).toHaveAccessibleName(
      'Generated image 1: A fluffy orange cat in a tiny astronaut helmet',
    );
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();
  });

  it('moves between results with the arrow keys and wraps around', async () => {
    const user = userEvent.setup();
    renderUi(<Host generation={three()} />);
    await user.keyboard('{ArrowRight}');
    expect(shown()).toHaveAttribute('src', '/api/v1/media/ast_b');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(shown()).toHaveAttribute('src', '/api/v1/media/ast_a');
    await user.keyboard('{ArrowLeft}');
    expect(shown()).toHaveAttribute('src', '/api/v1/media/ast_c');
  });

  it('follows what the user sees in Arabic: ArrowRight goes back, ArrowLeft goes on', async () => {
    const user = userEvent.setup();
    renderUi(<Host generation={three()} start={1} />, { locale: 'ar' });
    await user.keyboard('{ArrowRight}');
    expect(shown()).toHaveAttribute('src', '/api/v1/media/ast_a');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(shown()).toHaveAttribute('src', '/api/v1/media/ast_c');
    expect(screen.getByText('٣ من ٣')).toBeInTheDocument();
  });

  it('moves with the previous and next buttons', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    renderUi(<Host generation={three()} spy={spy} />);
    await user.click(screen.getByRole('button', { name: 'Next result' }));
    await user.click(screen.getByRole('button', { name: 'Previous result' }));
    await user.click(screen.getByRole('button', { name: 'Previous result' }));
    expect(spy.mock.calls.map(([index]) => index)).toEqual([1, 0, 2]);
  });

  it('has no arrows and no position for a single result', () => {
    renderUi(<Host generation={generationDTO()} />);
    expect(screen.queryByRole('button', { name: 'Next result' })).not.toBeInTheDocument();
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument();
  });

  it('ignores the arrows while somebody types or a menu is open', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    renderUi(
      <>
        <input aria-label="Notes" />
        <Host generation={three()} spy={spy} handlers={{ onDelete: vi.fn() }} />
      </>,
    );
    // The dialog makes the page behind inert, so the input has to be inside the dialog to be reachable:
    // simulate the key event reaching a text field instead.
    const field = document.createElement('input');
    screen.getByRole('dialog').append(field);
    field.focus();
    await user.keyboard('{ArrowRight}');
    expect(spy).not.toHaveBeenCalled();

    field.remove();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(spy).not.toHaveBeenCalled();
  });

  it('zooms to the real size and back, from the button and from a click on the picture', async () => {
    const user = userEvent.setup();
    renderUi(<Host generation={generationDTO()} />);
    expect(shown().className).not.toContain('max-w-none');
    await user.click(screen.getByRole('button', { name: 'Zoom to full size' }));
    expect(shown().className).toContain('max-w-none');
    await user.click(screen.getByRole('button', { name: 'Fit to screen' }));
    expect(shown().className).not.toContain('max-w-none');
    await user.click(shown());
    expect(shown().className).toContain('max-w-none');
  });

  it('starts every picture fitted: zoom does not carry over to the next one', async () => {
    const user = userEvent.setup();
    renderUi(<Host generation={three()} />);
    await user.click(screen.getByRole('button', { name: 'Zoom to full size' }));
    await user.click(screen.getByRole('button', { name: 'Next result' }));
    expect(shown().className).not.toContain('max-w-none');
    expect(screen.getByRole('button', { name: 'Zoom to full size' })).toBeInTheDocument();
  });

  it('plays a real video with controls and has nothing to zoom', () => {
    renderUi(
      <Host
        generation={generationDTO({
          kind: 'video',
          tool: 'text-to-video',
          outputs: [assetDTO({ id: 'ast_v', kind: 'video', mimeType: 'video/mp4' })],
        })}
      />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', '/api/v1/media/ast_v');
    expect(video.controls).toBe(true);
    expect(screen.queryByRole('button', { name: /Zoom|Fit to screen/ })).not.toBeInTheDocument();
  });

  it('downloads the picture on screen', async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.getAttribute('href') ?? '');
    });
    const user = userEvent.setup();
    renderUi(<Host generation={three()} start={1} />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(clicks).toEqual(['/api/v1/media/ast_b?download=1']);
  });

  it('offers favorite and share only when the page can do them, and calls them with the generation', async () => {
    const generation = three();
    const user = userEvent.setup();
    const { unmount } = renderUi(<Host generation={generation} />);
    expect(screen.queryByRole('button', { name: 'Favorite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share to Explore' })).not.toBeInTheDocument();
    unmount();

    const handlers = { onToggleFavorite: vi.fn(), onTogglePublic: vi.fn() };
    renderUi(
      <Host generation={{ ...generation, isFavorite: true, isPublic: true }} handlers={handlers} />,
    );
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(handlers.onToggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ id: generation.id }),
    );
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(handlers.onTogglePublic).toHaveBeenCalledTimes(1);
  });

  it('leaves "View larger" out of its own menu', async () => {
    const user = userEvent.setup();
    renderUi(<Host generation={three()} handlers={{ onOpen: vi.fn(), onDelete: vi.fn() }} />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const items = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(items).not.toContain('View larger');
    expect(items).toContain('Delete');
  });

  it('closes on Escape and with the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<Host generation={three()} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the last generation while it fades out', () => {
    const generation = three();
    const { rerender } = renderUi(<Host generation={generation} />);
    rerender(<Host generation={null} />);
    expect(screen.getByRole('dialog', { name: /A fluffy orange cat/ })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    renderUi(
      <Host
        generation={three()}
        handlers={{ onToggleFavorite: vi.fn(), onTogglePublic: vi.fn(), onDelete: vi.fn() }}
      />,
    );
    await act(async () => {});
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
