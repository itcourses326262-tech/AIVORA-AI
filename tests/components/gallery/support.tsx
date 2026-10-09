import { vi } from 'vitest';
import { GalleryView } from '@/components/gallery/gallery-view';
import { DEFAULT_FILTERS, type GalleryFilters } from '@/components/gallery/filters';
import { Toaster, toast } from '@/components/ui/toast';
import type { GenerationDTO } from '@/lib/api-types';
import type { Locale } from '@/lib/i18n/locales';
import { newId } from '@/lib/id';
import { UserProvider } from '@/lib/user-context';
import { renderUi } from '../render';
import { resetRouter, router } from './router';
import {
  USER,
  assetDTO,
  generationDTO,
  installFakeApi,
  json,
  type Call,
  type FakeApi,
  type FakeApiOptions,
} from '../generations/support';

export { USER, assetDTO, generationDTO, json, resetRouter, router };

/** `count` finished images, newest first, with ids that sort the way the server's do. */
export function creations(
  count: number,
  make: (index: number) => Partial<GenerationDTO> = () => ({}),
): GenerationDTO[] {
  const base = Date.now() - 60_000;
  return Array.from({ length: count }, (_, index) =>
    generationDTO({
      id: newId('gen', base - index * 1000),
      prompt: `Creation number ${index + 1}`,
      createdAt: base - index * 1000,
      outputs: [assetDTO({ id: newId('ast') })],
      ...make(index),
    }),
  );
}

/**
 * Teaches the fake API the gallery's `GET /generations` filters (`kind`, `status`, `favorite`, `q`)
 * and cursors, which the studio's fake does not implement. `?ids=` keeps its default answer.
 */
export interface GalleryApi extends FakeApi {
  /** Answers the matching call itself, before the fake does; return nothing to let it through. */
  override: (handler: (call: Call) => Response | Promise<Response> | undefined) => void;
}

export function withFilters(base: FakeApi, pageSize?: number): GalleryApi {
  const overrides: Array<(call: Call) => Response | Promise<Response> | undefined> = [];
  const api: GalleryApi = Object.assign(base, {
    override: (handler: (call: Call) => Response | Promise<Response> | undefined) => {
      overrides.push(handler);
    },
  });
  api.intercept((call) => {
    for (const handler of overrides) {
      const answer = handler(call);
      if (answer) return Promise.resolve(answer);
    }
    return undefined;
  });
  api.intercept((call) => {
    if (call.method !== 'GET' || !call.path.startsWith('/generations?')) return undefined;
    const url = new URL(call.path, 'http://localhost');
    if (url.searchParams.has('ids')) return undefined;
    const { searchParams } = url;
    const kind = searchParams.get('kind');
    const status = searchParams.get('status');
    const favorite = searchParams.get('favorite');
    const q = searchParams.get('q')?.toLowerCase();
    const matching = api.generations.filter(
      (generation) =>
        (!kind || generation.kind === kind) &&
        (!status || generation.status === status) &&
        (favorite !== 'true' || generation.isFavorite) &&
        (!q || generation.prompt.toLowerCase().includes(q)),
    );
    const limit = pageSize ?? Number(searchParams.get('limit') ?? 20);
    const start = Number(searchParams.get('cursor') ?? 0);
    const more = start + limit < matching.length;
    return Promise.resolve(
      json({
        data: matching.slice(start, start + limit),
        nextCursor: more ? String(start + limit) : null,
      }),
    );
  });
  return api;
}

export interface MountGalleryOptions extends FakeApiOptions {
  locale?: Locale;
  filters?: Partial<GalleryFilters>;
  pageSize?: number;
  /** Runs before the gallery renders, e.g. to make requests fail. */
  prepare?: (api: GalleryApi) => void;
}

export function mountGallery(options: MountGalleryOptions = {}) {
  const api = withFilters(installFakeApi(options), options.pageSize);
  options.prepare?.(api);
  const view = renderUi(
    <UserProvider initialUser={{ ...USER, creditBalance: api.balance }}>
      <Toaster />
      <GalleryView initialFilters={{ ...DEFAULT_FILTERS, ...options.filters }} />
    </UserProvider>,
    { locale: options.locale },
  );
  return { api, view };
}

export function resetEnvironment() {
  toast.dismissAll();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/gallery');
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetRouter();
}

/** Prompts of the cards on screen, in document order. */
export function shownPrompts(): string[] {
  return Array.from(document.querySelectorAll('article')).map(
    (card) => card.querySelector('p[dir="auto"]')?.textContent ?? '',
  );
}

/** The `GET /generations` calls that are listings (not polling). */
export function listCalls(api: FakeApi) {
  return api.callsTo('GET', '/generations?').filter((call) => !call.path.includes('ids='));
}

/** An error answer in the API's envelope. */
export function failure(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: 'English message' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
