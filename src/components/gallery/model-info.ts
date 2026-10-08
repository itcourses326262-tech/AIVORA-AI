import { getModel } from '@/lib/catalog';
import type { Locale } from '@/lib/i18n/locales';

export interface ModelInfo {
  /** Display name; the id itself for a model the catalog no longer lists. */
  label: string;
  /** A Demo (sample) model. */
  demo: boolean;
  /** One sentence in the active language, when the catalog has one. */
  description?: string;
}

/**
 * How a model is named next to a creation. The catalog is bundled with the page, so no request is
 * needed and a model that has since been removed still shows its id.
 */
export function modelInfo(modelId: string, locale?: Locale): ModelInfo {
  const model = getModel(modelId);
  if (!model) return { label: modelId, demo: false };
  return {
    label: model.label,
    demo: model.badges?.includes('demo') ?? false,
    ...(locale ? { description: model.description[locale] } : {}),
  };
}
