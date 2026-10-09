import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationDTO } from '@/lib/api-types';
import { newId } from '@/lib/id';
import {
  DEMO_IMAGE,
  DEMO_VIDEO,
  FLUX_UNAVAILABLE,
  apiError,
  assetDTO,
  generationDTO,
  installFakeUploads,
  type FakeUpload,
} from '../generations/support';
import {
  cards,
  installDomStubs,
  mountStudio,
  promptBox,
  ready,
  resetEnvironment,
  within,
} from './support';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/studio' }));

let uploads: FakeUpload[];

beforeEach(() => {
  installDomStubs();
  uploads = installFakeUploads();
  nav.push.mockClear();
});
afterEach(resetEnvironment);

const tab = (name: string) => screen.getByRole('tab', { name });

async function choose(user: ReturnType<typeof userEvent.setup>, item: string, card = 0) {
  const menus = screen.getAllByRole('button', { name: 'More actions' });
  await user.click(menus[card] as HTMLElement);
  await user.click(screen.getByRole('menuitem', { name: item }));
}

const imageRun = (overrides: Partial<GenerationDTO> = {}) =>
  generationDTO({ outputs: [assetDTO({ id: 'ast_result' })], ...overrides });

const videoRun = (overrides: Partial<GenerationDTO> = {}) =>
  generationDTO({
    tool: 'text-to-video',
    kind: 'video',
    modelId: 'aivore-demo-video',
    params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p' },
    cost: 15,
    outputs: [assetDTO({ id: 'ast_clip', kind: 'video', mimeType: 'image/gif', durationMs: 5000 })],
    ...overrides,
  });

describe('Studio: use a result as the input image', () => {
  it('sends an image result to image-to-image as it is, without uploading it again', async () => {
    const { api } = mountStudio({ generations: [imageRun({ prompt: 'A lighthouse' })] });
    await ready();
    const user = userEvent.setup();
    await choose(user, 'Use as input image');
    expect(tab('Image to image')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('img', { name: 'Your input image' })).toHaveAttribute(
      'src',
      '/api/v1/media/ast_result?variant=thumb',
    );
    expect(uploads).toHaveLength(0);
    await waitFor(() => expect(promptBox()).toHaveFocus());

    await user.type(promptBox(), 'Make it snowy');
    await user.click(screen.getByRole('button', { name: /^Generate/ }));
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      tool: 'image-to-image',
      inputAssetId: 'ast_result',
    });
  });

  it('keeps the image-to-video tool when already on it', async () => {
    mountStudio({ generations: [imageRun()], prefill: { tool: 'image-to-video' } });
    await ready();
    await choose(userEvent.setup(), 'Use as input image');
    expect(tab('Image to video')).toHaveAttribute('aria-selected', 'true');
  });

  it('sends the still frame of a video result, copied as a new input, and offers image-to-video from a video tool', async () => {
    const fetchCalls: string[] = [];
    mountStudio({
      generations: [videoRun()],
      prefill: { tool: 'text-to-video' },
      prepare: (fake) =>
        fake.intercept((call) => {
          if (call.method === 'GET' && call.path.startsWith('/media/ast_clip')) {
            fetchCalls.push(call.path);
            return new Response(new Uint8Array([7, 7, 7]), {
              headers: {
                'content-type': call.path.includes('variant=thumb') ? 'image/webp' : 'image/gif',
              },
            });
          }
          return undefined;
        }),
    });
    await ready();
    const user = userEvent.setup();
    await choose(user, 'Use as input image');
    expect(tab('Image to video')).toHaveAttribute('aria-selected', 'true');
    // The status says the picture is being prepared.
    expect(await screen.findByText('Preparing your image…')).toBeInTheDocument();
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(fetchCalls).toEqual(['/media/ast_clip?variant=thumb']);
    expect((uploads[0]?.file as File).type).toBe('image/webp');
    uploads[0]?.respond(201, { data: assetDTO({ id: 'ast_frame' }) });
    expect(await screen.findByRole('button', { name: 'Replace' })).toBeInTheDocument();
  });

  it('says so when the frame cannot be copied', async () => {
    mountStudio({
      generations: [videoRun()],
      prefill: { tool: 'text-to-video' },
    });
    await ready();
    await choose(userEvent.setup(), 'Use as input image');
    // The fake API has no media route: both reads fail.
    expect(
      await screen.findByText('We could not use that image. Choose another one.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Drop an image or click to upload' }),
    ).toBeInTheDocument();
  });
});

describe('Studio: reuse the settings of a generation', () => {
  it('puts the whole request back: tool, model, prompt, options and the input image', async () => {
    const input = assetDTO({ id: newId('ast'), width: 800, height: 600 });
    mountStudio({
      generations: [
        videoRun({
          tool: 'image-to-video',
          prompt: 'Slow cinematic zoom',
          negativePrompt: undefined,
          params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p', seed: 77 },
          input,
        }),
      ],
    });
    await ready();
    const user = userEvent.setup();
    await choose(user, 'Reuse settings');

    expect(tab('Image to video')).toHaveAttribute('aria-selected', 'true');
    expect(promptBox()).toHaveValue('Slow cinematic zoom');
    expect(await screen.findByRole('radio', { name: '5 sec' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '720p' })).toBeChecked();
    expect(screen.getByText('800 × 600 px')).toBeInTheDocument();
    // Nothing is sent: the person adjusts and presses Generate, so the cursor is in the prompt.
    await waitFor(() => expect(promptBox()).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    expect(screen.getByRole('textbox', { name: /Seed/ })).toHaveValue('77');
    expect(
      await screen.findByText('Settings restored. Adjust them and generate again.'),
    ).toBeInTheDocument();
  });

  it('takes the input image off when reusing a text-to-image generation after an image one', async () => {
    mountStudio({
      generations: [imageRun({ prompt: 'A plain prompt' })],
      prefill: { tool: 'image-to-image', inputAssetId: newId('ast') },
    });
    await ready();
    await screen.findByRole('img', { name: 'Your input image' });
    await choose(userEvent.setup(), 'Reuse settings');
    expect(tab('Text to image')).toHaveAttribute('aria-selected', 'true');
    expect(promptBox()).toHaveValue('A plain prompt');
    // Back on an image tool the input is not carried over from the old session.
    await userEvent.setup().click(tab('Image to image'));
    expect(screen.getByRole('img', { name: 'Your input image' })).toBeInTheDocument();
  });

  it('warns when the model of the generation is not available any more, and keeps the rest', async () => {
    mountStudio({
      models: [DEMO_IMAGE(), DEMO_VIDEO()],
      generations: [imageRun({ modelId: 'removed-model', prompt: 'Keep this text' })],
    });
    await ready();
    await choose(userEvent.setup(), 'Reuse settings');
    expect(
      await screen.findByText('The original model is not available, so another one was chosen.'),
    ).toBeInTheDocument();
    expect(promptBox()).toHaveValue('Keep this text');
    expect(screen.getByRole('radio', { name: /AIVORE Demo Image/ })).toBeChecked();
  });
});

describe('Studio: try a failed generation again', () => {
  const failed = (overrides: Partial<GenerationDTO> = {}) =>
    generationDTO({
      status: 'failed',
      outputs: [],
      progress: 20,
      prompt: 'A quiet beach',
      params: { aspectRatio: '4:3', count: 2, seed: 5 },
      cost: 2,
      error: { code: 'unavailable', message: 'x' },
      ...overrides,
    });

  it('submits the same settings again, with a new key, and puts the new card on top', async () => {
    const original = failed();
    const { api } = mountStudio({ generations: [original] });
    await ready();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toEqual({
      tool: 'text-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'A quiet beach',
      params: { aspectRatio: '4:3', count: 2, seed: 5 },
      isPublic: false,
    });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(cards()[0]?.getAttribute('data-generation-id')).toMatch(/^gen_/);
    expect(cards()[0]?.getAttribute('data-generation-id')).not.toBe(original.id);
    expect(cards()[0]).toHaveAttribute('data-status', 'queued');
    // The form was not touched.
    expect(promptBox()).toHaveValue('');
  });

  it('sends the input image of an image generation again', async () => {
    const input = assetDTO({ id: newId('ast') });
    const { api } = mountStudio({
      generations: [
        failed({ tool: 'image-to-image', input, params: { aspectRatio: '1:1', count: 1 } }),
      ],
    });
    await ready();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      tool: 'image-to-image',
      inputAssetId: input.id,
    });
  });

  it('does not try without the credits, and offers to get some', async () => {
    const { api } = mountStudio({ generations: [failed()], balance: 1 });
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText("You don't have enough credits for this.")).toBeInTheDocument();
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);
    const toast = screen
      .getByText("You don't have enough credits for this.")
      .closest('[data-variant]') as HTMLElement;
    await user.click(within(toast).getByRole('button', { name: 'Get credits' }));
    expect(nav.push).toHaveBeenCalledWith('/pricing');
  });

  it('does not try with a model that is not set up on this server', async () => {
    const { api } = mountStudio({
      models: [DEMO_IMAGE(), FLUX_UNAVAILABLE()],
      generations: [failed({ modelId: 'fal-flux-schnell' })],
    });
    await ready();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText(
        'That model is not available on this server right now. Choose another one.',
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);
  });
});

describe('Studio: viewer, deleting and running work', () => {
  it('opens the viewer on a result and closes it when that generation is deleted', async () => {
    mountStudio({ generations: [imageRun({ prompt: 'A lighthouse' })] });
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /View larger: Generated image 1/ }));
    const dialog = await screen.findByRole('dialog', { name: /A lighthouse/ });
    await user.click(within(dialog).getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(cards()).toHaveLength(0));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /A lighthouse/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Your canvas is waiting')).toBeInTheDocument();
  });

  it('brings a running generation to its result by itself, and tells the user', async () => {
    const running = generationDTO({
      status: 'processing',
      progress: 30,
      outputs: [],
      prompt: 'Waves',
    });
    const { api } = mountStudio({ generations: [running], balance: 49 });
    await ready();
    expect(cards()[0]).toHaveAttribute('data-status', 'processing');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    api.generations = [
      { ...running, status: 'succeeded', progress: 100, outputs: [assetDTO({ id: 'ast_done' })] },
    ];
    expect(
      await screen.findByText('Your image is ready', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(cards()[0]).toHaveAttribute('data-status', 'succeeded');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0);

    // The "View" button of the toast opens the result.
    await userEvent.setup().click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('dialog', { name: /Waves/ })).toBeInTheDocument();
  }, 10_000);

  it('drops a card whose generation was deleted somewhere else', async () => {
    const running = generationDTO({ status: 'processing', progress: 30, outputs: [] });
    const { api } = mountStudio({ generations: [running] });
    await ready();
    api.generations = [];
    await waitFor(() => expect(cards()).toHaveLength(0), { timeout: 5000 });
  }, 10_000);

  it('shows a failure that happens while the page is open, with the reason and the refund', async () => {
    const running = generationDTO({ status: 'processing', progress: 30, outputs: [] });
    const { api } = mountStudio({ generations: [running] });
    await ready();
    api.generations = [
      { ...running, status: 'failed', error: { code: 'content_policy', message: 'x' } },
    ];
    expect(
      await screen.findByText('The generation failed', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(cards()[0]).toHaveAttribute('data-status', 'failed');
    expect(screen.getAllByText(/declined by the content policy/).length).toBeGreaterThan(0);
  }, 10_000);

  it('closes the cancel question when the generation finishes behind it, and sends nothing', async () => {
    const running = generationDTO({
      status: 'processing',
      progress: 90,
      outputs: [],
      prompt: 'Waves',
    });
    const { api } = mountStudio({ generations: [running] });
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this generation?' });
    expect(within(dialog).getByText(/credits will be refunded in full/)).toBeInTheDocument();

    api.generations = [
      { ...running, status: 'succeeded', progress: 100, outputs: [assetDTO({ id: 'ast_done' })] },
    ];
    expect(
      await screen.findByText('Your image is ready', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    // The promise of a refund is gone with the question; nothing was canceled.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.callsTo('POST', `/generations/${running.id}/cancel`)).toHaveLength(0);
    expect(cards()[0]).toHaveAttribute('data-status', 'succeeded');
  }, 10_000);

  it('says it was too late when a cancel is confirmed just as the generation finishes', async () => {
    const running = generationDTO({ status: 'processing', progress: 90, outputs: [] });
    const { api } = mountStudio({
      generations: [running],
      prepare: (fake) =>
        fake.intercept((call) => {
          if (!call.path.endsWith('/cancel')) return undefined;
          // It finished between the click and the server looking at it.
          fake.generations = [
            { ...running, status: 'succeeded', progress: 100, outputs: [assetDTO()] },
          ];
          return apiError(409, 'conflict', { status: 'succeeded' });
        }),
    });
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel generation' }));
    expect(
      await screen.findByText('It had already finished, so it could not be canceled.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(cards()[0]).toHaveAttribute('data-status', 'succeeded'));
    expect(api.callsTo('POST', `/generations/${running.id}/cancel`)).toHaveLength(1);
  }, 10_000);
});
