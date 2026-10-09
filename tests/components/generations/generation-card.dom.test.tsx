import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationCard, StatusBadge } from '@/components/generations';
import type { GenerationDTO } from '@/lib/api-types';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { renderUi } from '../render';
import { axeViolations } from '../axe';
import { assetDTO, generationDTO } from './support';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function allHandlers(): Required<GenerationHandlers> {
  return {
    onOpen: vi.fn(),
    onToggleFavorite: vi.fn(),
    onTogglePublic: vi.fn(),
    onCopyLink: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    onReuse: vi.fn(),
    onRetry: vi.fn(),
    onUseAsInput: vi.fn(),
  };
}

const card = () => screen.getByRole('article');

describe('GenerationCard: work in progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:30Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a queued generation as waiting, with no percentage, an elapsed timer and Cancel', () => {
    const handlers = allHandlers();
    renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'queued',
          progress: 0,
          outputs: [],
          createdAt: Date.parse('2026-10-08T12:00:00Z'),
        })}
        handlers={handlers}
      />,
    );
    expect(card()).toHaveAttribute('aria-busy', 'true');
    expect(card()).toHaveAccessibleName(/Image: A lone lighthouse at sunset\. Queued/);
    expect(screen.getByText('Waiting for a free slot…')).toBeInTheDocument();
    expect(screen.getByText(/^Elapsed \u2066?0:30\u2069?$/)).toBeInTheDocument();
    // Indeterminate: the bar has no value while the job has not started.
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('shows progress and keeps the timer ticking while it is processing', () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'processing',
          progress: 45,
          outputs: [],
          createdAt: Date.parse('2026-10-08T12:00:00Z'),
        })}
        handlers={allHandlers()}
      />,
    );
    expect(screen.getByText('Creating your image…')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByText(/^Elapsed \u2066?0:30\u2069?$/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/^Elapsed \u2066?0:35\u2069?$/)).toBeInTheDocument();
  });

  it('names the kind of work: a video, or several images', () => {
    const { unmount } = renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'processing',
          kind: 'video',
          tool: 'text-to-video',
          outputs: [],
        })}
      />,
    );
    expect(screen.getByText('Creating your video…')).toBeInTheDocument();
    unmount();
    renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'processing',
          outputs: [],
          params: { aspectRatio: '1:1', count: 3 },
        })}
      />,
    );
    expect(screen.getByText('Creating your images…')).toBeInTheDocument();
  });

  it('calls onCancel, and disables Cancel for an optimistic card with no real id yet', async () => {
    vi.useRealTimers();
    const handlers = allHandlers();
    const generation = generationDTO({ status: 'processing', outputs: [] });
    const user = userEvent.setup();
    const { rerender } = renderUi(<GenerationCard generation={generation} handlers={handlers} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledWith(generation);

    rerender(<GenerationCard generation={generation} handlers={handlers} pending />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // The menu needs a real id: it is not offered yet.
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });
});

describe('GenerationCard: accessibility of a running card', () => {
  it('has no accessibility violations while running', async () => {
    const { container } = renderUi(
      <GenerationCard
        generation={generationDTO({ status: 'processing', progress: 30, outputs: [] })}
        handlers={allHandlers()}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('GenerationCard: results', () => {
  it('shows an image as a thumbnail tile that opens the viewer', async () => {
    const handlers = allHandlers();
    const generation = generationDTO({ outputs: [assetDTO({ id: 'ast_one' })] });
    const user = userEvent.setup();
    renderUi(
      <GenerationCard generation={generation} handlers={handlers} modelLabel="Sample Image" demo />,
    );

    const img = screen.getByRole('img', { name: /Generated image 1: A lone lighthouse at sunset/ });
    expect(img).toHaveAttribute('src', '/api/v1/media/ast_one?variant=thumb');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(card()).toHaveAttribute('data-status', 'succeeded');
    expect(card()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Sample Image')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('1 credit')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /View larger: Generated image 1/ }));
    expect(handlers.onOpen).toHaveBeenCalledWith(generation, 0);
  });

  it('leaves the Demo tag out when the model name already says Demo', () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({ outputs: [assetDTO()] })}
        modelLabel="AIVORE Demo Image"
        demo
      />,
    );
    expect(screen.getByText('AIVORE Demo Image')).toBeInTheDocument();
    expect(screen.queryByText('Demo')).not.toBeInTheDocument();
  });

  it('lays several results out as tiles, each opening at its own number', async () => {
    const handlers = allHandlers();
    const generation = generationDTO({
      params: { aspectRatio: '1:1', count: 3 },
      outputs: [assetDTO(), assetDTO(), assetDTO()],
    });
    const user = userEvent.setup();
    renderUi(<GenerationCard generation={generation} handlers={handlers} />);
    const tiles = screen.getAllByRole('button', { name: /View larger/ });
    expect(tiles).toHaveLength(3);
    // Three results never leave an empty cell: the first one spans both columns.
    expect(tiles[0]).toHaveClass('col-span-2');
    expect(tiles[1]).not.toHaveClass('col-span-2');
    expect(tiles[2]).not.toHaveClass('col-span-2');
    await user.click(tiles[2] as HTMLElement);
    expect(handlers.onOpen).toHaveBeenCalledWith(generation, 2);
    expect(screen.getByRole('img', { name: /Generated image 3/ })).toBeInTheDocument();
  });

  it('plays the Demo video, a GIF, as an animated <img> and shows its length', () => {
    const generation = generationDTO({
      kind: 'video',
      tool: 'text-to-video',
      outputs: [
        assetDTO({
          id: 'ast_gif',
          kind: 'video',
          mimeType: 'image/gif',
          durationMs: 5000,
          width: 480,
          height: 270,
        }),
      ],
    });
    renderUi(<GenerationCard generation={generation} handlers={allHandlers()} />);
    const img = screen.getByRole('img', { name: /Generated video preview: A lone lighthouse/ });
    expect(img).toHaveAttribute('src', '/api/v1/media/ast_gif');
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('5 sec')).toBeInTheDocument();
  });

  it('keeps a GIF still for a person who asked for reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderUi(
      <GenerationCard
        generation={generationDTO({
          kind: 'video',
          tool: 'text-to-video',
          outputs: [assetDTO({ id: 'ast_gif', kind: 'video', mimeType: 'image/gif' })],
        })}
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/v1/media/ast_gif?variant=thumb');
  });

  it('uses a <video> with controls and a poster for a real video, which is not a button', () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({
          kind: 'video',
          tool: 'text-to-video',
          outputs: [
            assetDTO({ id: 'ast_mp4', kind: 'video', mimeType: 'video/mp4', durationMs: 6000 }),
          ],
        })}
        handlers={allHandlers()}
      />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', '/api/v1/media/ast_mp4');
    expect(video).toHaveAttribute('poster', '/api/v1/media/ast_mp4?variant=thumb');
    expect(video.controls).toBe(true);
    expect(video).toHaveAttribute('preload', 'none');
    expect(screen.queryByRole('button', { name: /View larger/ })).not.toBeInTheDocument();
  });

  it('replaces a file that fails to load with a quiet message', () => {
    renderUi(<GenerationCard generation={generationDTO()} handlers={allHandlers()} />);
    const img = screen.getByRole('img', { name: /Generated image 1/ });
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(screen.getByRole('img', { name: 'This file could not be loaded.' })).toBeInTheDocument();
  });

  it('toggles the favorite with a pressed state, and marks a shared generation', async () => {
    const handlers = allHandlers();
    const user = userEvent.setup();
    const { rerender } = renderUi(
      <GenerationCard generation={generationDTO({ isFavorite: false })} handlers={handlers} />,
    );
    const heart = screen.getByRole('button', { name: 'Favorite' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    await user.click(heart);
    expect(handlers.onToggleFavorite).toHaveBeenCalledTimes(1);

    rerender(
      <GenerationCard
        generation={generationDTO({ isFavorite: true, isPublic: true })}
        handlers={handlers}
      />,
    );
    expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('has no accessibility violations with results, with several results, or for a video', async () => {
    const states: GenerationDTO[] = [
      generationDTO(),
      generationDTO({
        params: { aspectRatio: '1:1', count: 2 },
        outputs: [assetDTO(), assetDTO()],
      }),
      generationDTO({
        kind: 'video',
        outputs: [assetDTO({ kind: 'video', mimeType: 'video/mp4', durationMs: 4000 })],
      }),
    ];
    for (const generation of states) {
      const { container, unmount } = renderUi(
        <GenerationCard generation={generation} handlers={allHandlers()} />,
      );
      expect(await axeViolations(container)).toEqual([]);
      unmount();
    }
  });
});

describe('GenerationCard: failure and cancellation', () => {
  it('explains a failure in words, says the credits came back and offers Try again', async () => {
    const handlers = allHandlers();
    const generation = generationDTO({
      status: 'failed',
      outputs: [],
      error: { code: 'content_policy', message: 'English message for logs' },
    });
    const user = userEvent.setup();
    renderUi(<GenerationCard generation={generation} handlers={handlers} />);
    expect(screen.getByText('Generation failed')).toBeInTheDocument();
    expect(screen.getByText(/declined by the content policy/)).toBeInTheDocument();
    expect(screen.queryByText('English message for logs')).not.toBeInTheDocument();
    expect(screen.getByText('Your credits were refunded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(handlers.onRetry).toHaveBeenCalledWith(generation);
  });

  it('says a canceled generation was refunded and does not push a retry', () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({ status: 'canceled', outputs: [] })}
        handlers={allHandlers()}
      />,
    );
    expect(screen.getByText('Canceled')).toBeInTheDocument();
    expect(screen.getByText('You canceled this generation.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'failed',
          outputs: [],
          error: { code: 'timeout', message: '' },
        })}
        handlers={allHandlers()}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('GenerationCard: actions menu', () => {
  async function openMenu() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    return { user, menu: screen.getByRole('menu') };
  }
  const names = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent?.trim());

  it('offers everything for a finished generation: view, download, favorite, share, reuse, input, delete', async () => {
    renderUi(<GenerationCard generation={generationDTO()} handlers={allHandlers()} />);
    const { menu } = await openMenu();
    expect(names(menu)).toEqual([
      'View larger',
      'Download',
      'Add to favorites',
      'Share to Explore',
      'Reuse settings',
      'Use as input image',
      'Delete',
    ]);
  });

  it('adapts to the state: unfavorite, stop sharing and copy link for a shared favorite; "Download all" for several', async () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({
          isFavorite: true,
          isPublic: true,
          params: { aspectRatio: '1:1', count: 2 },
          outputs: [assetDTO(), assetDTO()],
        })}
        handlers={allHandlers()}
      />,
    );
    const { menu } = await openMenu();
    expect(names(menu)).toEqual([
      'View larger',
      'Download all',
      'Remove from favorites',
      'Stop sharing',
      'Copy link',
      'Reuse settings',
      'Use as input image',
      'Delete',
    ]);
  });

  it('offers retry (not download or input) for a failed generation', async () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'failed',
          outputs: [],
          error: { code: 'internal', message: '' },
        })}
        handlers={allHandlers()}
      />,
    );
    const { menu } = await openMenu();
    expect(names(menu)).toEqual(['Reuse settings', 'Try again', 'Delete']);
  });

  it('offers cancel for a running generation', async () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({ status: 'processing', outputs: [] })}
        handlers={allHandlers()}
      />,
    );
    const { menu } = await openMenu();
    expect(names(menu)).toEqual(['Reuse settings', 'Cancel', 'Delete']);
  });

  it('lists only what the page supports', async () => {
    renderUi(<GenerationCard generation={generationDTO()} handlers={{ onDelete: vi.fn() }} />);
    const { menu } = await openMenu();
    // Downloads are plain links to the media route and need no handler.
    expect(names(menu)).toEqual(['Download', 'Delete']);
  });

  it('shows no menu at all when there is nothing to offer', () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({
          status: 'failed',
          outputs: [],
          error: { code: 'internal', message: '' },
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it('runs the handler of the chosen item with the generation', async () => {
    const handlers = allHandlers();
    const generation = generationDTO();
    renderUi(<GenerationCard generation={generation} handlers={handlers} />);
    let { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Reuse settings' }));
    expect(handlers.onReuse).toHaveBeenCalledWith(generation);

    ({ user } = await openMenu());
    await user.click(screen.getByRole('menuitem', { name: 'Use as input image' }));
    expect(handlers.onUseAsInput).toHaveBeenCalledWith(generation, 0);

    ({ user } = await openMenu());
    await user.click(screen.getByRole('menuitem', { name: 'Share to Explore' }));
    expect(handlers.onTogglePublic).toHaveBeenCalledWith(generation);

    ({ user } = await openMenu());
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(handlers.onDelete).toHaveBeenCalledWith(generation);
  });

  it('downloads through the media route with ?download=1', async () => {
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({
        href: this.getAttribute('href') ?? '',
        download: this.getAttribute('download') ?? 'none',
      });
    });
    renderUi(
      <GenerationCard
        generation={generationDTO({ outputs: [assetDTO({ id: 'ast_dl' })] })}
        handlers={allHandlers()}
      />,
    );
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Download' }));
    expect(clicks).toEqual([{ href: '/api/v1/media/ast_dl?download=1', download: '' }]);
  });

  it('does not offer "Use as input" for a video without a still, and does for one with a thumbnail', async () => {
    const video = (thumb: boolean) =>
      generationDTO({
        kind: 'video',
        tool: 'text-to-video',
        outputs: [
          assetDTO({ kind: 'video', mimeType: 'video/mp4', thumbUrl: thumb ? '/t' : undefined }),
        ],
      });
    const { unmount } = renderUi(
      <GenerationCard generation={video(false)} handlers={allHandlers()} />,
    );
    let { menu } = await openMenu();
    expect(names(menu)).not.toContain('Use as input image');
    unmount();
    renderUi(<GenerationCard generation={video(true)} handlers={allHandlers()} />);
    ({ menu } = await openMenu());
    expect(names(menu)).toContain('Use as input image');
  });
});

describe('GenerationCard in Arabic', () => {
  it('speaks Arabic, with the prompt aligned by its own direction', () => {
    renderUi(
      <GenerationCard
        generation={generationDTO({ prompt: 'منارة وحيدة عند الغروب', cost: 2 })}
        handlers={allHandlers()}
      />,
      { locale: 'ar' },
    );
    expect(card()).toHaveAccessibleName(/صورة، منارة وحيدة عند الغروب\. جاهز/);
    expect(screen.getByText('منارة وحيدة عند الغروب')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('رصيدان')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مفضّل' })).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('always says the state in words', () => {
    for (const [status, text] of [
      ['queued', 'Queued'],
      ['processing', 'Creating'],
      ['succeeded', 'Ready'],
      ['failed', 'Failed'],
      ['canceled', 'Canceled'],
    ] as const) {
      const { unmount } = renderUi(<StatusBadge status={status} />);
      expect(screen.getByText(text)).toHaveAttribute('data-status', status);
      unmount();
    }
  });
});
