import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCost, getModel } from '@/lib/catalog';
import type { ModelSpec } from '@/lib/catalog/types';
import { toModelSpec } from '@/components/studio/form';
import { axeViolations } from '../axe';
import {
  DEMO_IMAGE,
  DEMO_VIDEO,
  EDIT_MODEL,
  FLUX_UNAVAILABLE,
  apiError,
  generationDTO,
  modelDTO,
} from '../generations/support';
import {
  generateButton,
  installDomStubs,
  mountStudio,
  promptBox,
  ready,
  resetEnvironment,
  within,
} from './support';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/studio' }));

beforeEach(() => {
  installDomStubs();
  nav.push.mockClear();
});
afterEach(resetEnvironment);

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Studio: loading, history and empty states', () => {
  it('shows the skeletons first, then the models and the first-run canvas', async () => {
    const { api } = mountStudio();
    expect(screen.getByText('Loading models')).toBeInTheDocument();
    expect(screen.getByText('Loading your creations')).toBeInTheDocument();
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Studio' })).toBeInTheDocument();
    expect(screen.getByText('Your canvas is waiting')).toBeInTheDocument();
    expect(api.callsTo('GET', '/models')).toHaveLength(1);
    expect(api.callsTo('GET', '/generations?limit=24')).toHaveLength(1);
  });

  it('shows the recent generations, newest first, with the model names', async () => {
    mountStudio({
      generations: [
        generationDTO({ prompt: 'Second prompt', createdAt: Date.now() - 1000 }),
        generationDTO({ prompt: 'First prompt', createdAt: Date.now() - 9000 }),
      ],
    });
    await ready();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('Second prompt')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('AIVORE Demo Image')).toBeInTheDocument();
    expect(screen.queryByText('Your canvas is waiting')).not.toBeInTheDocument();
  });

  it('loads more with the cursor and adds the older ones below', async () => {
    const all = Array.from({ length: 30 }, (_, index) =>
      generationDTO({ prompt: `Prompt ${index}`, createdAt: Date.now() - index * 1000 }),
    );
    const { api } = mountStudio({ generations: all });
    await ready();
    expect(screen.getAllByRole('article')).toHaveLength(24);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(30));
    expect(api.callsTo('GET', '/generations?limit=24&cursor=24')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when the history cannot be loaded, and tries again on request', async () => {
    let fail = true;
    mountStudio({
      generations: [generationDTO({ prompt: 'Back again' })],
      prepare: (api) =>
        api.intercept((call) =>
          fail && call.path.startsWith('/generations?limit')
            ? apiError(500, 'internal')
            : undefined,
        ),
    });
    await screen.findByText('We could not load your creations');
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => /Something went wrong on our side/.test(alert.textContent ?? '')),
    ).toBe(true);
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeInTheDocument();
  });

  it('says so when the models cannot be loaded, and tries again on request', async () => {
    let fail = true;
    mountStudio({
      prepare: (api) =>
        api.intercept((call) =>
          fail && call.path === '/models' ? apiError(500, 'internal') : undefined,
        ),
    });
    await screen.findByText('We could not load the models');
    expect(generateButton()).toBeDisabled();
    fail = false;
    const retry = screen.getAllByRole('button', { name: 'Try again' })[0] as HTMLElement;
    await userEvent.setup().click(retry);
    expect(await screen.findByRole('radio', { name: /AIVORE Demo Image/ })).toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
  });

  it('tells a person with no usable model so, and does not let them generate', async () => {
    mountStudio({ models: [FLUX_UNAVAILABLE()] });
    await screen.findByText('No model is available for this tool yet.');
    expect(generateButton()).toBeDisabled();
  });
});

describe('Studio: the four tools', () => {
  it('has the tools as tabs, the first selected, switched with the arrow keys', async () => {
    mountStudio();
    await ready();
    const tablist = screen.getByRole('tablist', { name: 'Creation tool' });
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Text to image', 'Image to image', 'Text to video', 'Image to video']);
    expect(tab('Text to image')).toHaveAttribute('aria-selected', 'true');

    const user = userEvent.setup();
    tab('Text to image').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Image to image')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Image to image')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Image to video')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Text to image')).toHaveAttribute('aria-selected', 'true');
  });

  it('follows the reading direction in Arabic: ArrowLeft goes to the next tool', async () => {
    mountStudio({ locale: 'ar' });
    await ready();
    const user = userEvent.setup();
    const tabs = screen.getAllByRole('tab');
    tabs[0]?.focus();
    await user.keyboard('{ArrowLeft}');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('puts the tool and the model in the address and remembers the choice', async () => {
    mountStudio();
    await ready();
    await waitFor(() =>
      expect(window.location.search).toBe('?tool=text-to-image&model=aivore-demo-image'),
    );
    await userEvent.setup().click(tab('Text to video'));
    await waitFor(() =>
      expect(window.location.search).toBe('?tool=text-to-video&model=aivore-demo-video'),
    );
    expect(JSON.parse(window.localStorage.getItem('aivore.studio.v1') ?? '{}').tool).toBe(
      'text-to-video',
    );
  });

  it('shows the controls each tool needs: the picture only for image tools, the clip options only for video', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    const has = (name: RegExp | string) => screen.queryByText(name) !== null;

    // text to image
    expect(has('Input image')).toBe(false);
    expect(has('Number of images')).toBe(true);
    expect(has('Duration')).toBe(false);
    expect(promptBox()).toHaveAttribute('placeholder', 'Describe the image you want to create…');

    await user.click(tab('Image to image'));
    expect(has('Input image')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Drop an image or click to upload' }),
    ).toBeInTheDocument();
    expect(promptBox()).toHaveAttribute('placeholder', 'Describe how your image should change…');

    await user.click(tab('Text to video'));
    expect(has('Input image')).toBe(false);
    expect(has('Number of images')).toBe(false);
    expect(has('Duration')).toBe(true);
    expect(has('Resolution')).toBe(true);
    expect(promptBox()).toHaveAttribute('placeholder', 'Describe the video you want to create…');

    await user.click(tab('Image to video'));
    expect(has('Input image')).toBe(true);
    expect(has('Duration')).toBe(true);
    expect(promptBox()).toHaveAttribute('placeholder', 'Describe how your image should move…');
  });

  it('lists only the models of the tool, flags Demo ones, and disables a model that is not configured', async () => {
    mountStudio({ models: [DEMO_IMAGE(), DEMO_VIDEO(), FLUX_UNAVAILABLE()] });
    await ready();
    const demo = screen.getByRole('radio', { name: /AIVORE Demo Image/ });
    expect(demo).toBeChecked();
    expect(within(demo).getByText('Demo')).toBeInTheDocument();
    expect(within(demo).getByText('1 credit per image')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Demo Video/ })).not.toBeInTheDocument();

    const flux = screen.getByRole('radio', { name: /FLUX.1 Schnell/ });
    expect(flux).toHaveAttribute('aria-disabled', 'true');
    expect(within(flux).getByText('Not set up on this server')).toBeInTheDocument();
    await userEvent.setup().click(flux);
    expect(demo).toBeChecked();

    await userEvent.setup().click(tab('Text to video'));
    const video = screen.getByRole('radio', { name: /AIVORE Demo Video/ });
    expect(within(video).getByText('From 2 credits per second')).toBeInTheDocument();
  });

  it('prefers a configured real model over the Demo one', async () => {
    mountStudio({ models: [DEMO_IMAGE(), modelDTO('fal-flux-schnell'), DEMO_VIDEO()] });
    await screen.findByRole('radio', { name: /FLUX.1 Schnell/ });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /FLUX.1 Schnell/ })).toBeChecked(),
    );
  });

  it('keeps the prompt when the tool changes and remembers the settings of every tool', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    await user.type(promptBox(), 'A cat in a hat');
    await user.click(screen.getByRole('radio', { name: 'Aspect ratio 16:9' }));
    await user.click(screen.getByRole('button', { name: 'One more image' }));
    await user.click(tab('Text to video'));
    expect(promptBox()).toHaveValue('A cat in a hat');
    await user.click(screen.getByRole('radio', { name: '5 sec' }));
    await user.click(tab('Text to image'));
    expect(screen.getByRole('radio', { name: 'Aspect ratio 16:9' })).toBeChecked();
    expect(screen.getByRole('button', { name: /^Generate · 2 credits$/ })).toBeInTheDocument();
    await user.click(tab('Text to video'));
    expect(screen.getByRole('radio', { name: '5 sec' })).toBeChecked();
  });
});

describe('Studio: options that depend on the model', () => {
  it('offers the aspect ratios, count, negative prompt, seed and strength the model supports', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    const ratios = screen.getAllByRole('radio', { name: /^Aspect ratio/ });
    expect(ratios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Aspect ratio 1:1',
      'Aspect ratio 16:9',
      'Aspect ratio 9:16',
      'Aspect ratio 4:3',
      'Aspect ratio 3:4',
    ]);
    expect(screen.getByRole('radio', { name: 'Aspect ratio 1:1' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Aspect ratio 9:16' }));
    expect(screen.getByRole('radio', { name: 'Aspect ratio 9:16' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    expect(screen.getByRole('textbox', { name: /Negative prompt/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Seed/ })).toBeInTheDocument();
    // Strength is for tools with a picture.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    await user.click(tab('Image to image'));
    expect(screen.getByRole('slider', { name: 'Strength' })).toHaveAttribute(
      'aria-valuenow',
      '0.6',
    );
  });

  it('leaves out the advanced options a model does not support, and the whole section when none', async () => {
    const first = mountStudio({ models: [modelDTO('fal-flux-schnell'), DEMO_VIDEO()] });
    await screen.findByRole('radio', { name: /FLUX.1 Schnell/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    // FLUX.1 Schnell: a seed, no negative prompt.
    expect(screen.getByRole('textbox', { name: /Seed/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Negative prompt/ })).not.toBeInTheDocument();

    const none: typeof DEMO_IMAGE extends () => infer M ? M : never = {
      ...DEMO_IMAGE(),
      limits: {
        ...DEMO_IMAGE().limits,
        supportsNegativePrompt: false,
        supportsSeed: false,
        supportsStrength: false,
      },
    };
    first.view.unmount();
    resetEnvironment();
    mountStudio({ models: [none] });
    await screen.findByRole('radio', { name: /AIVORE Demo Image/ });
    expect(screen.queryByRole('button', { name: 'Advanced options' })).not.toBeInTheDocument();
  });

  it('hides the whole aspect ratio control for a model that keeps the shape of the input image', async () => {
    mountStudio({
      models: [DEMO_IMAGE(), EDIT_MODEL(), DEMO_VIDEO()],
      prefill: { tool: 'image-to-image' },
    });
    await screen.findByRole('radio', { name: /Shape-keeping Edit/ });
    const user = userEvent.setup();
    // The Demo model has a choice of shapes.
    await user.click(screen.getByRole('radio', { name: /AIVORE Demo Image/ }));
    expect(screen.getByRole('radio', { name: 'Aspect ratio 16:9' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Shape-keeping Edit/ }));
    expect(screen.queryByText('Aspect ratio')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^Aspect ratio/ })).not.toBeInTheDocument();
    expect(screen.getByText('The result keeps the proportions of your image.')).toBeInTheDocument();
    // Other tools of the same model family still show it.
    await user.click(tab('Text to image'));
    expect(screen.getByRole('radio', { name: 'Aspect ratio 16:9' })).toBeInTheDocument();
  });

  it('only offers the durations and resolutions the video model allows, and a single choice is not a choice', async () => {
    const first = mountStudio({
      models: [DEMO_VIDEO()],
      prefill: { tool: 'text-to-video' },
    });
    await screen.findByRole('radio', { name: /Demo Video/ });
    expect(screen.getAllByRole('radio', { name: /sec$/ }).map((r) => r.textContent)).toEqual([
      '3 sec',
      '5 sec',
    ]);
    expect(screen.getAllByRole('radio', { name: /p$/ }).map((r) => r.textContent)).toEqual([
      '480p',
      '720p',
    ]);

    first.view.unmount();
    resetEnvironment();
    mountStudio({
      models: [modelDTO('fal-veo-3-1-fast', { available: true })],
      prefill: { tool: 'text-to-video' },
    });
    await screen.findByRole('radio', { name: /Veo 3.1 Fast/ });
    expect(screen.getAllByRole('radio', { name: /sec$/ })).toHaveLength(3);
    // Veo offers 720p only: no control for a single value.
    expect(screen.queryByText('Resolution')).not.toBeInTheDocument();
  });

  it('shows no count stepper for a model that makes one image at a time', async () => {
    mountStudio({ models: [modelDTO('fal-flux-2-pro', { available: true })] });
    await screen.findByRole('radio', { name: /FLUX.2 Pro/ });
    expect(screen.queryByText('Number of images')).not.toBeInTheDocument();
  });

  it('steps the number of images within what the model allows', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    const more = screen.getByRole('button', { name: 'One more image' });
    const fewer = screen.getByRole('button', { name: 'One fewer image' });
    expect(fewer).toBeDisabled();
    for (let i = 0; i < 5; i += 1) await user.click(more);
    expect(screen.getByText('4 images')).toBeInTheDocument();
    expect(more).toBeDisabled();
    await user.click(fewer);
    expect(screen.getByText('3 images')).toBeInTheDocument();
  });

  it('puts a random seed in with the dice, takes only digits, and clears it', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    const seed = screen.getByRole('textbox', { name: /Seed/ });
    await user.click(screen.getByRole('button', { name: 'Pick a random seed' }));
    expect((seed as HTMLInputElement).value).toMatch(/^\d{1,10}$/);
    await user.clear(seed);
    await user.type(seed, '12ab34');
    expect(seed).toHaveValue('1234');
    await user.clear(seed);
    await user.type(seed, '٤٢');
    expect(seed).toHaveValue('42');
    await user.click(screen.getByRole('button', { name: 'Clear the seed' }));
    expect(seed).toHaveValue('');
    await user.type(seed, '99999999999');
    expect(screen.getByText('Use a whole number from 0 to 4294967295.')).toBeInTheDocument();
  });
});

describe('Studio: cost and credits', () => {
  it('shows what the request costs, from the same function as the server, and the balance', async () => {
    mountStudio({ balance: 37 });
    await ready();
    const user = userEvent.setup();
    expect(screen.getByText('Balance: 37')).toBeInTheDocument();
    const spec = getModel('aivore-demo-image') as ModelSpec;
    expect(generateButton()).toHaveTextContent(
      `Generate · ${computeCost(spec, { aspectRatio: '1:1', count: 1 })} credit`,
    );

    await user.click(screen.getByRole('button', { name: 'One more image' }));
    await user.click(screen.getByRole('button', { name: 'One more image' }));
    expect(generateButton()).toHaveTextContent(
      `Generate · ${computeCost(spec, { aspectRatio: '1:1', count: 3 })} credits`,
    );

    await user.click(tab('Text to video'));
    await user.click(screen.getByRole('radio', { name: '5 sec' }));
    await user.click(screen.getByRole('radio', { name: '720p' }));
    const video = toModelSpec(DEMO_VIDEO());
    const expected = computeCost(video, {
      aspectRatio: '16:9',
      count: 1,
      durationSec: 5,
      resolution: '720p',
    });
    expect(expected).toBe(15);
    expect(generateButton()).toHaveTextContent(`Generate · ${expected} credits`);
  });

  it('blocks Generate and offers "Get credits" when the balance is short', async () => {
    mountStudio({ balance: 2 });
    await ready();
    const user = userEvent.setup();
    expect(generateButton()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'One more image' }));
    await user.click(screen.getByRole('button', { name: 'One more image' }));
    // 3 credits for 3 images, 2 in the account.
    expect(generateButton()).toBeDisabled();
    const notice = screen.getByText(
      /You don't have enough credits for this\. You need 1 credit more\./,
    );
    expect(notice).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Get credits' });
    expect(link).toHaveAttribute('href', '/pricing');
    await user.click(screen.getByRole('button', { name: 'One fewer image' }));
    expect(generateButton()).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'Get credits' })).not.toBeInTheDocument();
  });

  it('says so, instead of failing silently, when a model cannot be priced', async () => {
    const broken = { ...DEMO_VIDEO(), pricing: { type: 'video' as const, perSecond: {} } };
    mountStudio({ models: [broken], prefill: { tool: 'text-to-video' } });
    await screen.findByRole('radio', { name: /Demo Video/ });
    expect(
      screen.getByText('The cost cannot be calculated for these options.'),
    ).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
  });
});

describe('Studio: remembered settings and links', () => {
  it('restores the last settings of a tool on the next visit', async () => {
    const first = mountStudio();
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Aspect ratio 4:3' }));
    await user.click(screen.getByRole('button', { name: 'One more image' }));
    first.view.unmount();

    window.history.replaceState(null, '', '/studio');
    mountStudio();
    await ready();
    expect(screen.getByRole('radio', { name: 'Aspect ratio 4:3' })).toBeChecked();
    expect(screen.getByText('2 images')).toBeInTheDocument();
  });

  it('works without localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mountStudio();
    await ready();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Aspect ratio 3:4' }));
    expect(screen.getByRole('radio', { name: 'Aspect ratio 3:4' })).toBeChecked();
  });

  it('ignores corrupt stored settings', async () => {
    window.localStorage.setItem(
      'aivore.studio.v1',
      '{"tool":"nope","tools":{"text-to-image":{"aspectRatio":"7:7","count":99}}}',
    );
    mountStudio();
    await ready();
    expect(screen.getByRole('radio', { name: 'Aspect ratio 1:1' })).toBeChecked();
    expect(tab('Text to image')).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the tool, model and prompt a link asks for, then drops the one-shot parameters', async () => {
    window.history.replaceState(null, '', '/studio?tool=text-to-video&prompt=Slow%20waves');
    mountStudio({
      prefill: { tool: 'text-to-video', prompt: 'Slow waves', modelId: 'aivore-demo-video' },
    });
    await screen.findByRole('radio', { name: /AIVORE Demo Video/ });
    expect(tab('Text to video')).toHaveAttribute('aria-selected', 'true');
    expect(promptBox()).toHaveValue('Slow waves');
    await waitFor(() => expect(window.location.search).not.toContain('prompt='));
    expect(window.location.search).toContain('tool=text-to-video');
  });

  it('applies a new link while the studio is open', async () => {
    const { view } = mountStudio();
    await ready();
    const { Studio } = await import('@/components/studio/studio');
    const { UserProvider } = await import('@/lib/user-context');
    const { USER } = await import('../generations/support');
    view.rerender(
      <UserProvider initialUser={USER}>
        <Studio prefill={{ tool: 'text-to-video', prompt: 'From the gallery' }} />
      </UserProvider>,
    );
    await waitFor(() => expect(tab('Text to video')).toHaveAttribute('aria-selected', 'true'));
    expect(promptBox()).toHaveValue('From the gallery');
  });
});

describe('Studio: phone layout', () => {
  it('puts the prompt and Generate above the tab bar and the other controls in a sheet', async () => {
    mountStudio({ desktop: false });
    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(generateButton()).toBeInTheDocument();
    expect(promptBox()).toBeInTheDocument();
    // The model is not on the page until the sheet opens.
    expect(screen.queryByRole('radio', { name: /AIVORE Demo Image/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const sheet = await screen.findByRole('dialog', { name: 'Studio settings' });
    expect(within(sheet).getByRole('radio', { name: /AIVORE Demo Image/ })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: 'Aspect ratio 1:1' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: 'Aspect ratio 16:9' }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('radio', { name: 'Aspect ratio 16:9' })).toBeChecked();
  });

  it('keeps the tools one tap away and an "Add image" attachment for the image tools', async () => {
    mountStudio({ desktop: false });
    await screen.findByRole('button', { name: 'Settings' });
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Add image' })).not.toBeInTheDocument();
    await user.click(tab('Image to video'));
    expect(screen.getByRole('button', { name: 'Add image' })).toBeInTheDocument();
  });

  it('shows the cost on the button and the "get credits" notice in the strip', async () => {
    mountStudio({ desktop: false, balance: 0 });
    await screen.findByRole('button', { name: 'Settings' });
    // The notice needs the model, so the price: it appears once the catalog is there.
    expect(await screen.findByRole('link', { name: 'Get credits' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(generateButton()).toBeDisabled();
  });
});

describe('Studio: phone prompt strip', () => {
  const counterText = (used: string) => screen.queryByText(`${used} / 2,000`);

  it('counts characters against the limit once the end is in sight, as the roomy field does', async () => {
    mountStudio({ desktop: false });
    await screen.findByRole('button', { name: 'Settings' });
    fireEvent.change(promptBox(), { target: { value: 'x'.repeat(100) } });
    expect(counterText('100')).not.toBeInTheDocument();
    fireEvent.change(promptBox(), { target: { value: 'x'.repeat(1700) } });
    expect(counterText('1,700')).toBeInTheDocument();
    expect(promptBox().getAttribute('aria-describedby')).toMatch(/-count/);

    fireEvent.change(promptBox(), { target: { value: 'x'.repeat(2100) } });
    expect(counterText('2,100')).toBeInTheDocument();
    expect(
      screen.getByText('This prompt is too long for this model (up to 2000 characters).'),
    ).toBeInTheDocument();
  });

  it('wastes no line above the prompt: the box follows the attachment right away', async () => {
    mountStudio({ desktop: false, prefill: { tool: 'image-to-image' } });
    await screen.findByRole('button', { name: 'Add image' });
    // The roomy field has a label row; the strip has none, so the box is the first thing in it.
    const field = promptBox().closest('div[class*="border"]') as HTMLElement;
    expect(field.parentElement?.firstElementChild).toBe(field);
  });

  it('keeps the counter at all times in the roomy field of a wide screen', async () => {
    mountStudio();
    await ready();
    expect(screen.getByText('0 / 2,000')).toBeInTheDocument();
  });
});

describe('Studio in Arabic', () => {
  it('speaks Arabic in the controls, the prompt and the button, and lays out right to left', async () => {
    mountStudio({ locale: 'ar' });
    await screen.findByRole('radio', { name: /AIVORE Demo Image/ });
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1, name: 'الاستوديو' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'أداة الإنشاء' })).toBeInTheDocument();
    expect(promptBox()).toHaveAttribute('placeholder', 'صِف الصورة التي تريد إنشاءها…');
    expect(generateButton()).toHaveTextContent('إنشاء · رصيد واحد');
    expect(screen.getByText('الرصيد: ٥٠')).toBeInTheDocument();
    // The ratio stays "1:1", not reordered by the bidirectional algorithm.
    expect(screen.getByRole('radio', { name: 'نسبة الأبعاد 1:1' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /AIVORE Demo Image/ })).toHaveTextContent(
      'رصيد واحد للصورة',
    );
  });
});

describe('Studio accessibility', () => {
  it('has no violations on the desktop layout, in English and Arabic', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { view } = mountStudio({
        locale,
        generations: [
          generationDTO(),
          generationDTO({ status: 'failed', outputs: [], error: { code: 'timeout', message: '' } }),
          generationDTO({ status: 'processing', progress: 40, outputs: [] }),
        ],
      });
      await ready();
      expect(await axeViolations(view.container)).toEqual([]);
      view.unmount();
      resetEnvironment();
      installDomStubs();
    }
  }, 30_000);

  it('has no violations on the first-run state with the advanced options open', async () => {
    const { view } = mountStudio();
    await ready();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Advanced options' }));
    expect(await axeViolations(view.container)).toEqual([]);
  });

  it('has no violations on the phone layout with the sheet open', async () => {
    mountStudio({ desktop: false });
    await screen.findByRole('button', { name: 'Settings' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('dialog');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
