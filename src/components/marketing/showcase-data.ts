import type { MessageKey } from '@/lib/i18n';
import type { Kind, Tool } from '@/lib/catalog/types';

/**
 * Sample creations of the landing page mosaic. They are decorative placeholders drawn as SVG
 * (see `showcase-art.tsx`), not real generations: when real samples exist, replace this list with
 * their prompts, models and media and swap the art for the media in `showcase.tsx`. Prompts are
 * dictionary keys so both languages stay in `lib/i18n/messages/landing.ts`; model names are brand
 * names and stay as they are.
 */

export type ArtKind = 'dunes' | 'skyline' | 'bloom' | 'orbit' | 'tides' | 'peaks' | 'arches';

/** Footprint in the mosaic grid: `hero` is 2x2 cells, `tall` 1x2, `wide` 2x1, `square` 1x1. */
export type ShowcaseSize = 'hero' | 'tall' | 'wide' | 'square';

/** Deep to bright: the five colours an artwork is painted with. */
export type ArtPalette = readonly [
  deep: string,
  dark: string,
  mid: string,
  light: string,
  glow: string,
];

export interface ShowcaseItem {
  id: string;
  kind: Kind;
  tool: Tool;
  /** Display name of the (sample) model badge. */
  model: string;
  prompt: MessageKey;
  art: ArtKind;
  size: ShowcaseSize;
  palette: ArtPalette;
  /** Video samples only: the clip length shown on the fake player. */
  seconds?: number;
}

export const SHOWCASE_ITEMS: readonly ShowcaseItem[] = [
  {
    id: 'dunes',
    kind: 'image',
    tool: 'text-to-image',
    model: 'FLUX.2 Pro',
    prompt: 'landing.showcase.samples.dunes',
    art: 'dunes',
    size: 'hero',
    palette: ['#2a1140', '#7a2e5c', '#e0603a', '#f6a04d', '#ffd98a'],
  },
  {
    id: 'skyline',
    kind: 'video',
    tool: 'text-to-video',
    model: 'Veo 3.1 Fast',
    prompt: 'landing.showcase.samples.skyline',
    art: 'skyline',
    size: 'tall',
    palette: ['#070b1f', '#161a4a', '#4b2c8f', '#d0338f', '#22d3ee'],
    seconds: 8,
  },
  {
    id: 'bloom',
    kind: 'image',
    tool: 'text-to-image',
    model: 'Nano Banana Pro',
    prompt: 'landing.showcase.samples.bloom',
    art: 'bloom',
    size: 'square',
    palette: ['#0b0a24', '#3a1b6b', '#8b3fd0', '#ff6fae', '#ffe3a3'],
  },
  {
    id: 'orbit',
    kind: 'video',
    tool: 'image-to-video',
    model: 'Wan 2.6',
    prompt: 'landing.showcase.samples.orbit',
    art: 'orbit',
    size: 'square',
    palette: ['#05061a', '#14124a', '#3b2d9a', '#f0a35e', '#9fe7ff'],
    seconds: 5,
  },
  {
    id: 'tides',
    kind: 'video',
    tool: 'text-to-video',
    model: 'Wan 2.6',
    prompt: 'landing.showcase.samples.tides',
    art: 'tides',
    size: 'wide',
    palette: ['#0c2a4a', '#145b78', '#2aa6a6', '#ffb88a', '#fff0c9'],
    seconds: 5,
  },
  {
    id: 'peaks',
    kind: 'image',
    tool: 'text-to-image',
    model: 'FLUX.1 Schnell',
    prompt: 'landing.showcase.samples.peaks',
    art: 'peaks',
    size: 'square',
    palette: ['#080c24', '#1b2a5c', '#3d5a9e', '#aebfe8', '#f4f1ff'],
  },
  {
    id: 'arches',
    kind: 'image',
    tool: 'image-to-image',
    model: 'Nano Banana Pro',
    prompt: 'landing.showcase.samples.arches',
    art: 'arches',
    size: 'square',
    palette: ['#06143a', '#0e2a6b', '#1d4ed8', '#e9b949', '#fff0b8'],
  },
];
