import { vi } from 'vitest';
import { DetailView } from '@/components/gallery/detail-view';
import { saveNavSnapshot } from '@/components/gallery/nav-snapshot';
import { Toaster, toast } from '@/components/ui/toast';
import type { GenerationDTO } from '@/lib/api-types';
import type { Locale } from '@/lib/i18n/locales';
import { newId } from '@/lib/id';
import { UserProvider } from '@/lib/user-context';
import { renderUi } from '../render';
import { USER, installFakeApi, type FakeApi } from '../generations/support';
import { resetRouter } from './router';

export interface MountDetailOptions {
  locale?: Locale;
  /** Ids of the list the person came from (the opened one should be among them). */
  fromList?: { ids: string[]; from?: string };
  /** Other creations the fake API knows (polling answers from it). */
  others?: GenerationDTO[];
}

/** The detail page of `generation`, signed in, on a fake API that holds it. */
export function mountDetail(generation: GenerationDTO, options: MountDetailOptions = {}) {
  const api: FakeApi = installFakeApi({ generations: [generation, ...(options.others ?? [])] });
  if (options.fromList) {
    saveNavSnapshot({
      from: options.fromList.from ?? '/gallery',
      ids: options.fromList.ids,
      scrollY: 0,
      restore: false,
    });
  }
  const view = renderUi(
    <UserProvider initialUser={{ ...USER, creditBalance: api.balance }}>
      <Toaster />
      <DetailView initial={generation} />
    </UserProvider>,
    { locale: options.locale },
  );
  return { api, view };
}

export function resetDetailEnvironment() {
  toast.dismissAll();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetRouter();
}

export const genId = () => newId('gen');
