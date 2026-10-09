import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../axe';
import {
  DEMO_IMAGE,
  DEMO_VIDEO,
  FLUX_UNAVAILABLE,
  modelDTO,
  type FakeApi,
} from '../generations/support';
import {
  generateButton,
  installDomStubs,
  mountStudio,
  promptBox,
  ready,
  resetEnvironment,
  within,
  type MountOptions,
} from './support';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/studio' }));

beforeEach(() => {
  installDomStubs();
  nav.push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  resetEnvironment();
});

const FLUX = () => modelDTO('fal-flux-schnell');
const FLUX_PRO = () => modelDTO('fal-flux-2-pro');
/** A server with two real image models and the Demo ones. */
const CONFIGURED = () => [DEMO_IMAGE(), DEMO_VIDEO(), FLUX(), FLUX_PRO()];

const chip = () => screen.getByRole('button', { name: /^(Model|النموذج):/ });
const modelSheet = () => screen.findByRole('dialog', { name: /^(Choose a model|اختر النموذج)$/ });

/** The phone layout with its models and history loaded. */
async function mountPhone(options: MountOptions = {}) {
  const mounted = mountStudio({ desktop: false, ...options });
  await waitFor(() => expect(chip()).toBeEnabled());
  await waitFor(() => {
    if (screen.queryByText(/^(Loading your creations|جارٍ تحميل إبداعاتك)$/)) {
      throw new Error('history still loading');
    }
  });
  return { ...mounted, user: userEvent.setup() };
}

async function pickInChip(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(chip());
  await user.click(within(await modelSheet()).getByRole('radio', { name }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

/** The person comes back to the tab after a while (`Date` only; the page's own timers are real). */
async function comeBackAfter(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + ms);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
}

const modelRequests = (api: FakeApi) => api.callsTo('GET', '/models');

describe('Studio on a phone: the model chip in the composer', () => {
  it('sits between the prompt and the Generate button, with Settings beside Generate', async () => {
    await mountPhone();
    const strip = chip().parentElement as HTMLElement;
    expect(strip).toContainElement(promptBox());
    expect(strip).toContainElement(generateButton());
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(promptBox(), chip())).toBe(true);
    expect(follows(chip(), generateButton())).toBe(true);
    expect(follows(chip(), screen.getByRole('button', { name: 'Settings' }))).toBe(true);
  });

  it('is not there on a wide screen, where the models are listed on the page already', async () => {
    mountStudio();
    await ready();
    expect(screen.queryByRole('button', { name: /^Model:/ })).not.toBeInTheDocument();
  });

  it('names the model that will run and its price, a configured real one before the Demo', async () => {
    await mountPhone({ models: CONFIGURED() });
    expect(chip().textContent).toMatch(
      /^Model:\s*FLUX\.1 Schnell\s*·\s*1 credit per image\s*Change$/,
    );
    expect(generateButton()).toHaveTextContent('Generate · 1 credit');
  });

  it('shows the Demo model when it is all this server has', async () => {
    await mountPhone();
    expect(chip()).toHaveTextContent('AIVORE Demo Image');
    expect(chip()).toHaveTextContent('1 credit per image');
  });

  it('follows the tool: video tools show video models and per-second prices', async () => {
    const { user } = await mountPhone({ models: CONFIGURED() });
    await user.click(screen.getByRole('tab', { name: 'Text to video' }));
    expect(chip()).toHaveTextContent('AIVORE Demo Video');
    expect(chip()).toHaveTextContent(/per second/);
    await user.click(chip());
    const sheet = await modelSheet();
    expect(within(sheet).getAllByRole('radio')).toHaveLength(1);
    expect(within(sheet).queryByRole('radio', { name: /FLUX/ })).not.toBeInTheDocument();
  });
});

describe('Studio on a phone: choosing the model', () => {
  it('lists the models of the tool in a sheet, the one in use checked, those not set up marked', async () => {
    const { user } = await mountPhone({
      models: [DEMO_IMAGE(), DEMO_VIDEO(), FLUX_PRO(), FLUX_UNAVAILABLE()],
    });
    await user.click(chip());
    const sheet = await modelSheet();
    const radios = within(sheet).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(within(sheet).getByRole('radio', { name: /FLUX\.2 Pro/ })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: /FLUX\.1 Schnell/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(sheet).getByText('Not set up on this server')).toBeInTheDocument();
    // The Settings sheet is another one: only one dialog is open.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('uses the model that was picked: the chip, the price on Generate and the request all follow', async () => {
    const { user, api } = await mountPhone({ models: CONFIGURED() });
    await pickInChip(user, /FLUX\.2 Pro/);

    expect(chip().textContent).toMatch(/FLUX\.2 Pro\s*·\s*8 credits per image/);
    expect(generateButton()).toHaveTextContent('Generate · 8 credits');
    // Settings shows the same choice.
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'Studio settings' })).getByRole('radio', {
        name: /FLUX\.2 Pro/,
      }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.type(promptBox(), 'A lone lighthouse at sunset');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      tool: 'text-to-image',
      modelId: 'fal-flux-2-pro',
    });
  });

  it('respects a Demo model chosen on purpose, even with real models configured', async () => {
    const { user, api } = await mountPhone({ models: CONFIGURED() });
    await pickInChip(user, /AIVORE Demo Image/);
    expect(chip()).toHaveTextContent('AIVORE Demo Image');
    await user.type(promptBox(), 'Practice run');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      modelId: 'aivore-demo-image',
    });
  });

  it('remembers the choice for the next visit', async () => {
    const first = await mountPhone({ models: CONFIGURED() });
    await pickInChip(first.user, /FLUX\.2 Pro/);
    first.view.unmount();

    await mountPhone({ models: CONFIGURED() });
    expect(chip()).toHaveTextContent('FLUX.2 Pro');
  });

  it('closes the sheet without changing anything when Done is pressed', async () => {
    const { user } = await mountPhone({ models: CONFIGURED() });
    await user.click(chip());
    await user.click(within(await modelSheet()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(chip()).toHaveTextContent('FLUX.1 Schnell');
    expect(chip()).toHaveFocus();
  });

  it('does not start a generation by choosing: nothing is sent and nothing is spent', async () => {
    const { user, api } = await mountPhone({ models: CONFIGURED() });
    await pickInChip(user, /FLUX\.2 Pro/);
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);
    expect(api.balance).toBe(50);
  });

  it('is off while the models load, then on', async () => {
    let release: (() => void) | undefined;
    mountStudio({
      desktop: false,
      prepare: (api) =>
        api.intercept(async (call) => {
          if (call.method === 'GET' && call.path === '/models') {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return undefined;
        }),
    });
    await waitFor(() => expect(chip()).toBeDisabled());
    expect(chip()).toHaveTextContent('Loading models');
    expect(generateButton()).toBeDisabled();
    release?.();
    // The form picks its model one effect after the list arrives, so wait for the name.
    await waitFor(() => expect(chip()).toHaveTextContent('AIVORE Demo Image'));
    expect(chip()).toBeEnabled();
  });
});

describe('Studio on a phone: a provider key added while the page is open', () => {
  it('turns its models on when the person comes back to the tab, without a reload', async () => {
    const { api } = await mountPhone({
      models: [DEMO_IMAGE(), DEMO_VIDEO(), FLUX_UNAVAILABLE()],
    });
    expect(chip()).toHaveTextContent('AIVORE Demo Image');
    expect(modelRequests(api)).toHaveLength(1);

    api.models = [DEMO_IMAGE(), DEMO_VIDEO(), FLUX()];
    await comeBackAfter(6_000);
    await waitFor(() => expect(chip()).toHaveTextContent('FLUX.1 Schnell'));
    expect(modelRequests(api)).toHaveLength(2);
    expect(generateButton()).toHaveTextContent('Generate · 1 credit');
  });

  it('updates the list in place when the sheet is open, and keeps a model the person picked', async () => {
    const { user, api } = await mountPhone({
      models: [DEMO_IMAGE(), DEMO_VIDEO(), FLUX_PRO(), FLUX_UNAVAILABLE()],
    });
    await pickInChip(user, /AIVORE Demo Image/);

    await user.click(chip());
    const sheet = await modelSheet();
    const schnell = () => within(sheet).getByRole('radio', { name: /FLUX\.1 Schnell/ });
    expect(schnell()).toHaveAttribute('aria-disabled', 'true');

    api.models = [DEMO_IMAGE(), DEMO_VIDEO(), FLUX_PRO(), FLUX()];
    await comeBackAfter(6_000);
    await waitFor(() => expect(schnell()).not.toHaveAttribute('aria-disabled', 'true'));
    expect(within(sheet).getByRole('radio', { name: /AIVORE Demo Image/ })).toBeChecked();
    expect(within(sheet).queryByText('Not set up on this server')).not.toBeInTheDocument();
  });

  it('changes nothing on screen when the models are the same as before', async () => {
    const { user, api } = await mountPhone({ models: CONFIGURED() });
    await pickInChip(user, /FLUX\.2 Pro/);
    await comeBackAfter(6_000);
    await waitFor(() => expect(modelRequests(api)).toHaveLength(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(chip()).toHaveTextContent('FLUX.2 Pro');
    expect(generateButton()).toHaveTextContent('Generate · 8 credits');
  });
});

describe('Studio on a phone, in Arabic', () => {
  it('speaks Arabic, picks a model and closes the sheet', async () => {
    const { user, api } = await mountPhone({ locale: 'ar', models: CONFIGURED() });
    expect(document.documentElement.dir).toBe('rtl');
    expect(chip().textContent).toMatch(
      /^النموذج:\s*FLUX\.1 Schnell\s*·\s*رصيد واحد للصورة\s*تغيير$/,
    );

    await user.click(chip());
    const sheet = await modelSheet();
    expect(within(sheet).getByRole('radiogroup', { name: 'النموذج' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: /FLUX\.2 Pro/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(chip()).toHaveTextContent('FLUX.2 Pro');

    await user.type(promptBox(), 'منارة وحيدة عند الغروب');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toMatchObject({
      modelId: 'fal-flux-2-pro',
    });
  });
});

describe('Studio on a phone: accessibility of the model chip', () => {
  it('has no violations with the strip alone or with the model sheet open, in English and Arabic', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { user, view } = await mountPhone({ locale, models: CONFIGURED() });
      expect(await axeViolations(document.body)).toEqual([]);
      await user.click(chip());
      await modelSheet();
      expect(await axeViolations(document.body)).toEqual([]);
      view.unmount();
      resetEnvironment();
      installDomStubs();
    }
  }, 30_000);
});
