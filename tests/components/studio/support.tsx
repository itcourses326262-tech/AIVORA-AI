import { configure, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { resetResendCooldownForTests } from '@/components/layout/verify-email-banner';
import { Studio } from '@/components/studio/studio';
import type { StudioPrefill } from '@/components/studio/prefill';
import { toast } from '@/components/ui/toast';
import { Toaster } from '@/components/ui/toast';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { renderUi } from '../render';
import { USER, installFakeApi, type FakeApi, type FakeApiOptions } from '../generations/support';

// The studio loads, fetches and lays out whole pages of cards in jsdom; on a busy machine that can
// take longer than the defaults allow.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5000 });

export interface MountOptions extends FakeApiOptions {
  locale?: Locale;
  prefill?: StudioPrefill;
  /** `false` lays the studio out for a phone. */
  desktop?: boolean;
  /** Runs after the fake API is installed and before the studio renders (to make the first requests fail). */
  prepare?: (api: FakeApi) => void;
  /** Fields of the signed-in user the page starts with (the email confirmation state, say). */
  user?: Partial<CurrentUser>;
}

export interface Mounted {
  api: FakeApi;
  view: ReturnType<typeof renderUi>;
}

/** Stubs `matchMedia`: only the desktop query changes with `desktop`. */
export function stubViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('min-width') ? desktop : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** The studio on a fake API, signed in with the balance the API reports. */
export function mountStudio(options: MountOptions = {}): Mounted {
  const api = installFakeApi(options);
  options.prepare?.(api);
  if (options.desktop === false) stubViewport(false);
  const view = renderUi(
    <UserProvider initialUser={{ ...USER, creditBalance: api.balance, ...options.user }}>
      <Toaster />
      <Studio prefill={options.prefill ?? {}} />
    </UserProvider>,
    { locale: options.locale },
  );
  return { api, view };
}

/** Waits until the models and the history have arrived. */
export async function ready() {
  await screen.findByRole('radio', { name: /AIVORE Demo/ });
  await vi.waitFor(() => {
    if (screen.queryByText(/^(Loading your creations|جارٍ تحميل إبداعاتك)$/)) {
      throw new Error('history still loading');
    }
  });
}

export const promptBox = () =>
  screen
    .getAllByRole('textbox')
    .find(
      (box) => box.tagName === 'TEXTAREA' && box.id.startsWith('prompt-'),
    ) as HTMLTextAreaElement;

export const generateButton = () =>
  screen.getByRole('button', { name: /^(Generate|Starting|إنشاء|جارٍ البدء)/ });

export const cards = () => screen.queryAllByRole('article');

export function resetEnvironment() {
  resetResendCooldownForTests();
  toast.dismissAll();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/studio');
  vi.unstubAllGlobals();
}

export function installDomStubs() {
  Element.prototype.scrollIntoView = vi.fn();
}

/** The text of every toast on screen. */
export function toastTexts(): string[] {
  const regions = [
    screen.getByRole('status', { name: /Notifications|الإشعارات/ }),
    screen.getByRole('alert'),
  ];
  return regions.flatMap((region) =>
    Array.from(region.querySelectorAll('[data-variant]')).map((item) => item.textContent ?? ''),
  );
}

export { within };
