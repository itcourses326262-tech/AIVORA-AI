import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../axe';
import { assetDTO, generationDTO } from '../generations/support';
import { genId, mountDetail, resetDetailEnvironment } from './detail-support';
import { router } from './router';

vi.mock('next/navigation', async () => {
  const { router: mocked } = await import('./router');
  return { useRouter: () => mocked, usePathname: () => '/gallery/x' };
});

vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(resetDetailEnvironment);

const image = (extra = {}) =>
  generationDTO({
    id: genId(),
    prompt: 'A lone lighthouse at sunset',
    negativePrompt: 'blurry, low quality',
    cost: 3,
    params: { aspectRatio: '16:9', count: 1, seed: 42 },
    outputs: [assetDTO({ id: 'ast_main', width: 1280, height: 720, bytes: 123_456 })],
    createdAt: Date.parse('2026-10-08T10:00:00Z'),
    startedAt: Date.parse('2026-10-08T10:00:01Z'),
    finishedAt: Date.parse('2026-10-08T10:00:05Z'),
    ...extra,
  });

const video = (extra = {}) =>
  generationDTO({
    id: genId(),
    kind: 'video',
    tool: 'text-to-video',
    modelId: 'aivore-demo-video',
    prompt: 'Waves on a black beach',
    params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p' },
    outputs: [
      assetDTO({
        id: 'ast_clip',
        kind: 'video',
        mimeType: 'video/mp4',
        durationMs: 5000,
        width: 1280,
        height: 720,
      }),
    ],
    ...extra,
  });

describe('what the page shows', () => {
  it('shows the prompt, the negative prompt, the model, the settings, the cost and the times', () => {
    mountDetail(image());
    expect(
      screen.getByRole('heading', { level: 1, name: /A lone lighthouse at sunset/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('blurry, low quality')).toBeInTheDocument();
    const details = screen.getByRole('region', { name: 'Details' });
    const row = (label: string) =>
      within(details).getByText(label).parentElement?.textContent ?? '';
    expect(row('Model')).toContain('AIVORE Demo Image');
    expect(row('Model')).toContain('Demo');
    expect(row('Tool')).toContain('Text to image');
    expect(row('Aspect ratio')).toContain('16:9');
    expect(row('Seed')).toContain('42');
    expect(row('Size')).toContain('1,280 × 720 px'.replace(',', ''));
    expect(row('Cost')).toContain('3 credits');
    expect(row('Status')).toContain('Ready');
    expect(row('Created')).toMatch(/Oct 8, 2026/);
    expect(row('Finished')).toContain('took 4 sec');
    for (const time of details.querySelectorAll('time')) {
      expect(time.getAttribute('datetime')).toMatch(/^2026-10-08T10:00:0\d\.000Z$/);
    }
  });

  it('leaves out the settings a creation does not have', () => {
    mountDetail(image({ negativePrompt: undefined, params: { aspectRatio: '1:1', count: 1 } }));
    expect(screen.queryByText('Negative prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('Seed')).not.toBeInTheDocument();
    expect(screen.queryByText('Duration')).not.toBeInTheDocument();
  });

  it('shows the duration and resolution of a video', () => {
    mountDetail(video());
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('Duration').parentElement).toHaveTextContent('5 sec');
    expect(within(details).getByText('Resolution').parentElement).toHaveTextContent('720p');
  });

  it('shows a real video with its own controls', () => {
    mountDetail(video());
    const player = document.querySelector('video');
    expect(player).not.toBeNull();
    expect(player).toHaveAttribute('controls');
  });

  it('lets a keyboard user into the prompt boxes, which scroll when a prompt is long', () => {
    mountDetail(image({ prompt: 'A long story. '.repeat(60) }));
    for (const name of ['Prompt', 'Negative prompt']) {
      const box = screen.getByRole('region', { name });
      expect(box).toHaveAttribute('tabindex', '0');
      expect(box).toHaveClass('overflow-y-auto');
    }
    expect(screen.getByRole('region', { name: 'Prompt' }).textContent).toContain('A long story.');
    expect(screen.getByRole('region', { name: 'Negative prompt' })).toHaveTextContent(
      'blurry, low quality',
    );
  });

  it('shows the picture inside a zoomable region named after the prompt', () => {
    mountDetail(image());
    const zoomable = screen.getByRole('group', {
      name: /A lone lighthouse at sunset.*plus or minus/,
    });
    expect(zoomable.querySelector('img')).toHaveAttribute('src', '/api/v1/media/ast_main');
  });

  it('has no accessibility violations, in English and in Arabic', async () => {
    const en = mountDetail(image());
    fireEvent.load(en.view.container.querySelector('img') as HTMLImageElement);
    expect(await axeViolations(en.view.container)).toEqual([]);
    en.view.unmount();
    const ar = mountDetail(image(), { locale: 'ar' });
    expect(await axeViolations(ar.view.container)).toEqual([]);
  });
});

describe('the actions', () => {
  it('downloads the original file, not the thumbnail', () => {
    mountDetail(image());
    const link = screen.getByRole('link', { name: 'Download original' });
    expect(link).toHaveAttribute('href', '/api/v1/media/ast_main?download=1');
    expect(link).toHaveAttribute('download');
  });

  it('copies the prompt and says so', async () => {
    const u = userEvent.setup();
    mountDetail(image());
    await u.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await navigator.clipboard.readText()).toBe('A lone lighthouse at sunset');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('tells the person when the clipboard refuses', async () => {
    const u = userEvent.setup();
    mountDetail(image());
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await u.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(
      await screen.findByText('We could not copy the prompt. Select the text and copy it by hand.'),
    ).toBeInTheDocument();
  });

  it('toggles the favorite at once and saves it', async () => {
    const { api } = mountDetail(image());
    const button = screen.getByRole('button', { name: 'Add to favorites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(button);
    expect(await screen.findByRole('button', { name: 'Remove from favorites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(api.callsTo('PATCH', '/generations/')[0]?.body).toEqual({ isFavorite: true });
  });

  it('puts the favorite back when saving it fails', async () => {
    const { api } = mountDetail(image());
    api.intercept((call) =>
      call.method === 'PATCH'
        ? Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            }),
          )
        : undefined,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add to favorites' }));
    expect(await screen.findByText('We could not update this creation.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to favorites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('opens the studio with the same settings (Reuse settings)', () => {
    mountDetail(image());
    const link = screen.getByRole('link', { name: 'Reuse settings' });
    const target = new URL(link.getAttribute('href') as string, 'http://x');
    expect(target.pathname).toBe('/studio');
    expect(target.searchParams.get('prompt')).toBe('A lone lighthouse at sunset');
    expect(target.searchParams.get('tool')).toBe('text-to-image');
  });

  it('offers to edit or animate a picture, starting the studio from that very file', () => {
    mountDetail(image());
    const edit = new URL(
      screen.getByRole('link', { name: 'Edit this image' }).getAttribute('href') as string,
      'http://x',
    );
    expect(edit.searchParams.get('tool')).toBe('image-to-image');
    expect(edit.searchParams.get('input')).toBe('ast_main');
    const animate = new URL(
      screen.getByRole('link', { name: 'Animate this image' }).getAttribute('href') as string,
      'http://x',
    );
    expect(animate.searchParams.get('tool')).toBe('image-to-video');
  });

  it('offers a video’s still frame instead, and nothing when a video has no still', () => {
    const withStill = mountDetail(video());
    expect(screen.getByRole('link', { name: 'Edit this frame' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Animate this frame' })).toBeInTheDocument();
    withStill.view.unmount();
    mountDetail(
      video({
        outputs: [
          assetDTO({ id: 'ast_clip', kind: 'video', mimeType: 'video/mp4', thumbUrl: undefined }),
        ],
      }),
    );
    expect(screen.queryByRole('link', { name: /Edit this/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Animate this/ })).not.toBeInTheDocument();
  });

  it('asks before deleting, then deletes and goes back to the list it came from', async () => {
    const generation = image();
    const { api } = mountDetail(generation, {
      fromList: { ids: [generation.id], from: '/gallery?kind=image' },
    });
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this creation?' });
    expect(api.callsTo('DELETE', '/generations/')).toHaveLength(0);
    await u.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/gallery?kind=image'));
    expect(api.callsTo('DELETE', `/generations/${generation.id}`)).toHaveLength(1);
    // The deleted creation is gone from the list previous / next walks through.
    expect(JSON.parse(window.sessionStorage.getItem('aivore.gallery.nav.v1') ?? '{}').ids).toEqual(
      [],
    );
  });

  it('stays on the page when the question is declined', async () => {
    const { api } = mountDetail(image());
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Delete' }));
    await u.click(await screen.findByRole('button', { name: 'Keep' }));
    expect(api.callsTo('DELETE', '/generations/')).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('stays on the page and says so when the delete fails', async () => {
    const { api } = mountDetail(image());
    api.intercept((call) =>
      call.method === 'DELETE'
        ? Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            }),
          )
        : undefined,
    );
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Delete' }));
    await u.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('We could not update this creation.')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('sharing', () => {
  it('explains what becomes public and what never does, while sharing is off', () => {
    mountDetail(image());
    const panel = screen
      .getByRole('heading', { name: 'Share this creation' })
      .closest('div') as HTMLElement;
    expect(screen.getByRole('switch', { name: 'Share publicly' })).not.toBeChecked();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Everyone can see:');
    expect(text).toContain('the result, its prompt, the model and settings, and your first name.');
    expect(text).toContain('Never shown:');
    expect(text).toContain('your email, your credits, your other creations');
    expect(panel).toBeTruthy();
    expect(screen.queryByLabelText('Public link')).not.toBeInTheDocument();
  });

  it('turns sharing on, shows the public link, copies it and opens the public page', async () => {
    const generation = image();
    const { api } = mountDetail(generation);
    const u = userEvent.setup();
    await u.click(screen.getByRole('switch', { name: 'Share publicly' }));
    expect(await screen.findByRole('switch', { name: 'Share publicly' })).toBeChecked();
    expect(api.callsTo('PATCH', '/generations/')[0]?.body).toEqual({ isPublic: true });

    const link = await screen.findByLabelText('Public link');
    expect(link).toHaveValue(`${window.location.origin}/s/${generation.id}`);
    expect(link).toHaveAttribute('dir', 'ltr');
    expect(link).toHaveAttribute('readonly');
    // The toast that announced the sharing has a "Copy link" action too: use the panel's button.
    const panel = link.closest('.grid') as HTMLElement;
    await u.click(within(panel).getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/s/${generation.id}`,
    );
    const open = screen.getByRole('link', { name: 'Open public page' });
    expect(open).toHaveAttribute('href', `/s/${generation.id}`);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('turns sharing off again and hides the link', async () => {
    const { api } = mountDetail(image({ isPublic: true }));
    expect(screen.getByLabelText('Public link')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Share publicly' }));
    await waitFor(() => expect(screen.queryByLabelText('Public link')).not.toBeInTheDocument());
    expect(api.callsTo('PATCH', '/generations/')[0]?.body).toEqual({ isPublic: false });
  });

  it('has no share panel for a creation that did not succeed', () => {
    mountDetail(image({ status: 'failed', outputs: [], error: { code: 'timeout', message: 'x' } }));
    expect(screen.queryByRole('switch', { name: 'Share publicly' })).not.toBeInTheDocument();
  });
});

describe('creations that did not succeed', () => {
  it('says why a failed one failed, in words, that credits came back, and offers to try again', async () => {
    mountDetail(
      image({
        status: 'failed',
        outputs: [],
        error: { code: 'content_policy', message: 'Prompt rejected by provider X' },
      }),
    );
    expect(screen.getByText('Generation failed')).toBeInTheDocument();
    expect(
      screen.getByText('The prompt was declined by the content policy. Try different wording.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Your credits were refunded.')).toBeInTheDocument();
    // The provider's English message never reaches the page.
    expect(document.body.textContent).not.toContain('rejected by provider');
    expect(screen.queryByRole('link', { name: 'Download original' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    const target = new URL(router.push.mock.calls[0]?.[0] as string, 'http://x');
    expect(target.pathname).toBe('/studio');
    expect(target.searchParams.get('prompt')).toBe('A lone lighthouse at sunset');
  });

  it('keeps a failed creation deletable and reusable', () => {
    mountDetail(image({ status: 'failed', outputs: [], error: { code: 'timeout', message: 'x' } }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reuse settings' })).toBeInTheDocument();
  });

  it('explains a canceled one', () => {
    mountDetail(image({ status: 'canceled', outputs: [] }));
    expect(
      screen.getByText('You canceled this generation. Your credits were refunded.'),
    ).toBeInTheDocument();
  });

  it('shows progress for one still being made, and cancels it after a question', async () => {
    const running = image({ status: 'processing', progress: 45, outputs: [] });
    const { api } = mountDetail(running);
    await waitFor(() => expect(screen.getByText('Creating your image…')).toBeInTheDocument());
    const u = userEvent.setup();
    await u.click(screen.getAllByRole('button', { name: 'Cancel' })[0] as HTMLElement);
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this generation?' });
    await u.click(within(dialog).getByRole('button', { name: 'Cancel generation' }));
    await waitFor(() =>
      expect(api.callsTo('POST', `/generations/${running.id}/cancel`)).toHaveLength(1),
    );
    expect(
      await screen.findByText('You canceled this generation. Your credits were refunded.'),
    ).toBeInTheDocument();
  });

  it('shows the result as soon as polling finds the creation finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = image({ status: 'processing', progress: 80, outputs: [] });
    const { api } = mountDetail(running);
    await waitFor(() => expect(screen.getByText('Creating your image…')).toBeInTheDocument());
    api.generations[0] = {
      ...running,
      status: 'succeeded',
      progress: 100,
      outputs: [assetDTO({ id: 'ast_done' })],
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(screen.queryByText('Creating your image…')).not.toBeInTheDocument());
    expect(
      screen.getByRole('group', { name: /plus or minus/ }).querySelector('img'),
    ).toHaveAttribute('src', '/api/v1/media/ast_done');
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      '/api/v1/media/ast_done?download=1',
    );
  });

  it('goes back to the list when the creation was deleted elsewhere', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = image({ status: 'queued', progress: 0, outputs: [] });
    const { api } = mountDetail(running);
    api.generations = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/gallery'));
  });
});

describe('several results', () => {
  const two = () =>
    image({
      params: { aspectRatio: '1:1', count: 2 },
      outputs: [assetDTO({ id: 'ast_one' }), assetDTO({ id: 'ast_two' })],
    });

  it('switches between the results with the strip and downloads the one on show', async () => {
    mountDetail(two());
    expect(
      screen.getByRole('group', { name: /plus or minus/ }).querySelector('img'),
    ).toHaveAttribute('src', '/api/v1/media/ast_one');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show result 2 of 2' }));
    expect(
      screen.getByRole('group', { name: /plus or minus/ }).querySelector('img'),
    ).toHaveAttribute('src', '/api/v1/media/ast_two');
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      '/api/v1/media/ast_two?download=1',
    );
    expect(screen.getByRole('button', { name: 'Show result 2 of 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Download all' })).toBeInTheDocument();
  });

  it('offers a single result without a strip', () => {
    mountDetail(image());
    expect(screen.queryByRole('list', { name: 'Results' })).not.toBeInTheDocument();
  });
});

describe('previous and next', () => {
  const ids = [genId(), genId(), genId(), genId()];
  const current = () => image({ id: ids[1] });

  it('links to the neighbours in the list the person came from, and back to that list', () => {
    mountDetail(current(), { fromList: { ids, from: '/gallery?kind=image&q=sun' } });
    const nav = screen.getByRole('navigation', { name: 'Browse your gallery' });
    expect(within(nav).getByText('2 of 4')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Previous creation' })).toHaveAttribute(
      'href',
      `/gallery/${ids[0]}`,
    );
    expect(within(nav).getByRole('link', { name: 'Next creation' })).toHaveAttribute(
      'href',
      `/gallery/${ids[2]}`,
    );
    expect(within(nav).getByRole('link', { name: 'Back to gallery' })).toHaveAttribute(
      'href',
      '/gallery?kind=image&q=sun',
    );
  });

  it('disables previous at the start of the list and next at the end', () => {
    const first = mountDetail(image({ id: ids[0] }), { fromList: { ids } });
    expect(screen.queryByRole('link', { name: 'Previous creation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous creation' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Next creation' })).toBeInTheDocument();
    first.view.unmount();
    mountDetail(image({ id: ids[3] }), { fromList: { ids } });
    expect(screen.getByRole('button', { name: 'Next creation' })).toBeDisabled();
  });

  it('has no previous / next when the person did not come from the list, and goes back to /gallery', () => {
    mountDetail(current());
    const nav = screen.getByRole('navigation', { name: 'Browse your gallery' });
    expect(within(nav).queryByText(/of 4/)).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Next creation' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Back to gallery' })).toHaveAttribute(
      'href',
      '/gallery',
    );
  });

  it('ignores a list that does not contain this creation', () => {
    mountDetail(current(), { fromList: { ids: [genId(), genId()] } });
    expect(screen.queryByRole('link', { name: 'Next creation' })).not.toBeInTheDocument();
  });

  it('moves with the arrow keys the way the page reads: ArrowRight is next in English', async () => {
    mountDetail(current(), { fromList: { ids } });
    await userEvent.setup().keyboard('{ArrowRight}');
    expect(router.push).toHaveBeenCalledWith(`/gallery/${ids[2]}`);
    await userEvent.setup().keyboard('{ArrowLeft}');
    expect(router.push).toHaveBeenLastCalledWith(`/gallery/${ids[0]}`);
  });

  it('swaps the arrows in Arabic: ArrowLeft is next', async () => {
    mountDetail(current(), { fromList: { ids }, locale: 'ar' });
    await userEvent.setup().keyboard('{ArrowLeft}');
    expect(router.push).toHaveBeenCalledWith(`/gallery/${ids[2]}`);
  });

  it('leaves the arrow keys to a video player: seeking must not also change the page', () => {
    mountDetail(video({ id: ids[1] }), { fromList: { ids } });
    const player = document.querySelector('video');
    expect(player).not.toBeNull();
    fireEvent.keyDown(player as HTMLVideoElement, { key: 'ArrowRight' });
    fireEvent.keyDown(player as HTMLVideoElement, { key: 'ArrowLeft' });
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(router.push).toHaveBeenCalledWith(`/gallery/${ids[2]}`);
  });

  it.each(['slider', 'tablist', 'radiogroup', 'listbox'])(
    'leaves the arrow keys to a %s',
    (role) => {
      mountDetail(current(), { fromList: { ids } });
      const widget = document.createElement('div');
      widget.setAttribute('role', role);
      const inner = document.createElement('button');
      widget.append(inner);
      document.body.append(widget);
      fireEvent.keyDown(inner, { key: 'ArrowRight' });
      expect(router.push).not.toHaveBeenCalled();
      widget.remove();
    },
  );

  it('takes one step per key press, not one per repeat of a held key', () => {
    mountDetail(current(), { fromList: { ids } });
    for (let index = 0; index < 5; index += 1) {
      fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: index > 0 });
    }
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(`/gallery/${ids[2]}`);
  });

  it('does not steal the arrow keys while someone types or a dialog is open', async () => {
    mountDetail(current(), { fromList: { ids } });
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    await u.keyboard('{ArrowRight}');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('in Arabic', () => {
  it('speaks Arabic, formats numbers with the locale’s digits and keeps the link readable left to right', () => {
    const generation = image({ isPublic: true });
    mountDetail(generation, { locale: 'ar' });
    expect(screen.getByRole('link', { name: 'تنزيل الملف الأصلي' })).toBeInTheDocument();
    expect(screen.getByText('الوصف')).toBeInTheDocument();
    const details = screen.getByRole('region', { name: 'التفاصيل' });
    expect(details.textContent).toMatch(/[٠-٩]/);
    expect(screen.getByLabelText('الرابط العلني')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('يراه الجميع:')).toBeInTheDocument();
  });
});
