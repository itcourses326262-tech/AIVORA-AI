import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelChip } from '@/components/studio/model-chip';
import type { ModelsState } from '@/components/studio/use-models';
import type { StudioController } from '@/components/studio/use-studio';
import type { ModelDTO } from '@/lib/api-types';
import type { Locale } from '@/lib/i18n/locales';
import { ApiError } from '@/lib/api-client';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { DEMO_IMAGE, FLUX_UNAVAILABLE, modelDTO } from '../generations/support';

afterEach(() => {
  vi.unstubAllGlobals();
});

const FLUX = () => modelDTO('fal-flux-schnell');
const FLUX_PRO = () => modelDTO('fal-flux-2-pro');

interface Setup {
  /** What the picker lists; defaults to a real model, the Demo one and one that is not set up. */
  toolModels?: ModelDTO[];
  /** The model in use; `null` for none (the default is the first of `toolModels`). */
  model?: ModelDTO | null;
  models?: ModelsState;
  locale?: Locale;
}

/** Just the parts of the studio the chip reads: the model, the list, `setModel` and the load state. */
function mountChip({ toolModels, model, models, locale }: Setup = {}) {
  const list = toolModels ?? [FLUX_PRO(), DEMO_IMAGE(), FLUX_UNAVAILABLE()];
  const setModel = vi.fn();
  const reload = vi.fn();
  const studio = {
    models: { ...(models ?? { status: 'ready', models: list }), reload },
    form: { model: model === null ? undefined : (model ?? list[0]), toolModels: list, setModel },
  } as unknown as StudioController;
  const view = renderUi(<ModelChip studio={studio} />, { locale });
  return { ...view, setModel, reload, user: userEvent.setup() };
}

const chip = () => screen.getByRole('button', { name: /^(Model|النموذج):/ });
const sheet = () => screen.findByRole('dialog', { name: /^(Choose a model|اختر النموذج)$/ });

describe('ModelChip', () => {
  it('names the model in use and its price on one line, with a hint that it can be changed', () => {
    mountChip();
    const button = chip();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toBeEnabled();
    // jsdom has no layout, so the flex items are not told apart by spaces; a browser does.
    expect(button.textContent).toMatch(/^Model:\s*FLUX\.2 Pro\s*·\s*8 credits per image\s*Change$/);
    // Decorative icons stay out of the name.
    expect(button.querySelectorAll('svg')).not.toHaveLength(0);
    for (const icon of button.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('shows the price per second for a video model', () => {
    const video = modelDTO('aivore-demo-video');
    mountChip({ toolModels: [video], model: video });
    expect(chip().textContent).toMatch(/AIVORE Demo Video\s*·\s*(From )?\d+ credits? per second/);
  });

  it('keeps the list closed until the chip is pressed', async () => {
    const { user } = mountChip();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(chip());
    const dialog = await sheet();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The group is named "Model"; the sheet itself "Choose a model".
    const group = within(dialog).getByRole('radiogroup', { name: 'Model' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual([
      expect.stringContaining('FLUX.2 Pro'),
      expect.stringContaining('AIVORE Demo Image'),
      expect.stringContaining('FLUX.1 Schnell'),
    ]);
  });

  it('marks the model in use as the checked one', async () => {
    const list = [FLUX_PRO(), DEMO_IMAGE(), FLUX()];
    const { user } = mountChip({ toolModels: list, model: list[2] });
    await user.click(chip());
    const dialog = await sheet();
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).ariaChecked)).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(radios[2]).toHaveTextContent('FLUX.1 Schnell');
  });

  it('chooses the model that is pressed, closes the sheet and gives focus back to the chip', async () => {
    const list = [FLUX(), FLUX_PRO(), DEMO_IMAGE()];
    const { user, setModel } = mountChip({ toolModels: list });
    await user.click(chip());
    const dialog = await sheet();
    await user.click(within(dialog).getByRole('radio', { name: /FLUX\.2 Pro/ }));
    expect(setModel).toHaveBeenCalledExactlyOnceWith('fal-flux-2-pro');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(chip()).toHaveFocus();
  });

  it('can be chosen with the keyboard as well', async () => {
    const list = [FLUX(), FLUX_PRO()];
    const { user, setModel } = mountChip({ toolModels: list });
    await user.click(chip());
    const dialog = await sheet();
    within(dialog)
      .getByRole('radio', { name: /FLUX\.1 Schnell/ })
      .focus();
    await user.keyboard('{ArrowDown}');
    expect(setModel).toHaveBeenLastCalledWith('fal-flux-2-pro');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes with Done or Escape without choosing anything', async () => {
    const { user, setModel } = mountChip();
    await user.click(chip());
    await user.click(within(await sheet()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(chip());
    await sheet();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(setModel).not.toHaveBeenCalled();
  });

  it('opens again after a choice, with the list as before', async () => {
    const { user, setModel } = mountChip({ toolModels: [FLUX(), FLUX_PRO()] });
    for (const name of [/FLUX\.2 Pro/, /FLUX\.1 Schnell/]) {
      await user.click(chip());
      await user.click(within(await sheet()).getByRole('radio', { name }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(setModel.mock.calls).toEqual([['fal-flux-2-pro'], ['fal-flux-schnell']]);
  });

  it('shows the models this server does not have as disabled, with the reason, and cannot pick them', async () => {
    const { user, setModel } = mountChip();
    await user.click(chip());
    const dialog = await sheet();
    const [real, demo, missing] = within(dialog).getAllByRole('radio');
    // A radio that cannot be chosen is `aria-disabled`, which keeps it in the reading order.
    expect(real).not.toHaveAttribute('aria-disabled', 'true');
    expect(demo).not.toHaveAttribute('aria-disabled', 'true');
    expect(missing).toHaveAttribute('aria-disabled', 'true');
    expect(real).not.toHaveTextContent('Not set up on this server');
    expect(missing).toHaveTextContent('Not set up on this server');

    await user.click(missing as HTMLElement);
    expect(setModel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks to choose when nothing is usable, and still shows why in the list', async () => {
    const { user } = mountChip({ toolModels: [FLUX_UNAVAILABLE()], model: null });
    expect(chip().textContent).toMatch(/^Model:\s*Choose a model\s*Change$/);
    await user.click(chip());
    const dialog = await sheet();
    expect(within(dialog).getByRole('radio')).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByText('Not set up on this server')).toBeInTheDocument();
  });

  it('says so when the tool has no model at all', async () => {
    const { user } = mountChip({ toolModels: [], model: null });
    await user.click(chip());
    const dialog = await sheet();
    expect(within(dialog).getByText('No model is available for this tool yet.')).toBeVisible();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
  });

  it('is off, and says why, while the models are loading', async () => {
    const { user } = mountChip({
      models: { status: 'loading' },
      toolModels: [],
      model: null,
    });
    const button = chip();
    expect(button).toBeDisabled();
    expect(button.textContent).toMatch(/^Model:\s*Loading models\s*Change$/);
    await user.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('turns on when the models arrive', () => {
    const list = [FLUX(), DEMO_IMAGE()];
    const loading = { models: { status: 'loading' as const, reload: vi.fn() } };
    const studio = (ready: boolean) =>
      ({
        models: ready ? { status: 'ready', models: list, reload: vi.fn() } : loading.models,
        form: {
          model: ready ? list[0] : undefined,
          toolModels: ready ? list : [],
          setModel: vi.fn(),
        },
      }) as unknown as StudioController;
    const { rerender } = renderUi(<ModelChip studio={studio(false)} />);
    expect(chip()).toBeDisabled();
    rerender(<ModelChip studio={studio(true)} />);
    expect(chip()).toBeEnabled();
    expect(chip()).toHaveTextContent('FLUX.1 Schnell');
  });

  it('offers a retry in the sheet when the models could not be loaded', async () => {
    const { user, reload } = mountChip({
      models: {
        status: 'error',
        error: new ApiError('network_error', 0, 'Network request failed'),
      },
      toolModels: [],
      model: null,
    });
    expect(chip()).toBeEnabled();
    await user.click(chip());
    const dialog = await sheet();
    expect(within(dialog).getByText('We could not load the models')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('has nothing for axe to object to, closed and open', async () => {
    const { user, container } = mountChip();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(chip());
    await sheet();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('ModelChip in Arabic', () => {
  it('speaks Arabic, keeps the model name as it is and lays out right to left', async () => {
    const list = [DEMO_IMAGE(), FLUX_PRO(), FLUX_UNAVAILABLE()];
    const { user, setModel } = mountChip({ locale: 'ar', toolModels: list });
    expect(document.documentElement.dir).toBe('rtl');
    const button = chip();
    expect(button.textContent).toMatch(
      /^النموذج:\s*AIVORE Demo Image\s*·\s*رصيد واحد للصورة\s*تغيير$/,
    );

    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'اختر النموذج' });
    const group = within(dialog).getByRole('radiogroup', { name: 'النموذج' });
    const [, pro, missing] = within(group).getAllByRole('radio');
    expect(missing).toHaveAttribute('aria-disabled', 'true');
    expect(missing).toHaveTextContent('غير مُعدّ على هذا الخادم');
    expect(within(dialog).getByRole('button', { name: 'تم' })).toBeInTheDocument();

    await user.click(pro as HTMLElement);
    expect(setModel).toHaveBeenCalledExactlyOnceWith('fal-flux-2-pro');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('uses only logical (start/end) directions, so the chip mirrors', async () => {
    const { user } = mountChip({ locale: 'ar' });
    await user.click(chip());
    await screen.findByRole('dialog');
    const classes = Array.from(document.querySelectorAll('[class]')).map(
      (node) => node.getAttribute('class') ?? '',
    );
    expect(
      classes.filter((value) =>
        /(?:^|\s)(?:left|right|ml|mr|pl|pr|text-left|text-right)-/.test(value),
      ),
    ).toEqual([]);
    expect(chip().className).toContain('text-start');
  });

  it('has nothing for axe to object to, closed and open', async () => {
    const { user, container } = mountChip({ locale: 'ar' });
    expect(await axeViolations(container)).toEqual([]);
    await user.click(chip());
    await screen.findByRole('dialog');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
