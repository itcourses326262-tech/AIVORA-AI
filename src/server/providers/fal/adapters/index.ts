import 'server-only';
import { ProviderError } from '../../errors';
import { flux2Pro, fluxDevImg2Img, fluxSchnell } from './flux';
import { nanoBananaPro, nanoBananaProEdit } from './nano-banana';
import type { FalAdapter } from './shared';
import { veoImageToVideo, veoTextToVideo } from './veo';
import { wanImageToVideo, wanTextToVideo } from './wan';

export type { FalAdapter, FalBody } from './shared';

/** Keyed by the `providerModel` of the catalog entry (the fal endpoint id). */
export const FAL_ADAPTERS: Readonly<Record<string, FalAdapter>> = {
  'fal-ai/flux/schnell': fluxSchnell,
  'fal-ai/flux-2-pro': flux2Pro,
  'fal-ai/flux/dev/image-to-image': fluxDevImg2Img,
  'fal-ai/nano-banana-pro': nanoBananaPro,
  'fal-ai/nano-banana-pro/edit': nanoBananaProEdit,
  'wan/v2.6/text-to-video': wanTextToVideo,
  'wan/v2.6/image-to-video': wanImageToVideo,
  'fal-ai/veo3.1/fast': veoTextToVideo,
  'fal-ai/veo3.1/fast/image-to-video': veoImageToVideo,
};

export function getFalAdapter(endpoint: string): FalAdapter {
  const adapter = Object.hasOwn(FAL_ADAPTERS, endpoint) ? FAL_ADAPTERS[endpoint] : undefined;
  if (!adapter) {
    throw new ProviderError('unknown', `No fal adapter for endpoint ${endpoint}`, {
      retryable: false,
    });
  }
  return adapter;
}
