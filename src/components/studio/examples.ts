import type { MessageKey, TFunction } from '@/lib/i18n';
import type { Tool } from '@/lib/catalog/types';

/** The example prompts of each tool; the texts live in the dictionaries, in both languages. */
export const EXAMPLE_KEYS: Record<Tool, readonly MessageKey[]> = {
  'text-to-image': [
    'studio.examples.textToImage.lighthouse',
    'studio.examples.textToImage.astronaut',
    'studio.examples.textToImage.neonCity',
    'studio.examples.textToImage.cabin',
    'studio.examples.textToImage.desert',
  ],
  'image-to-image': [
    'studio.examples.imageToImage.watercolor',
    'studio.examples.imageToImage.winter',
    'studio.examples.imageToImage.golden',
    'studio.examples.imageToImage.anime',
    'studio.examples.imageToImage.sketch',
  ],
  'text-to-video': [
    'studio.examples.textToVideo.waves',
    'studio.examples.textToVideo.hummingbird',
    'studio.examples.textToVideo.clouds',
    'studio.examples.textToVideo.paperBoat',
    'studio.examples.textToVideo.fireflies',
  ],
  'image-to-video': [
    'studio.examples.imageToVideo.zoom',
    'studio.examples.imageToVideo.pan',
    'studio.examples.imageToVideo.drift',
    'studio.examples.imageToVideo.parallax',
    'studio.examples.imageToVideo.glow',
  ],
};

export function examplesFor(t: TFunction, tool: Tool): string[] {
  return EXAMPLE_KEYS[tool].map((key) => t(key));
}

/** A short title for a chip: the prompt up to its first comma (Latin or Arabic). */
export function exampleTitle(prompt: string): string {
  return (prompt.split(/[,،]/)[0] ?? prompt).trim();
}

/** A random example other than `current`, so "Surprise me" always changes the text. */
export function randomExample(
  examples: readonly string[],
  current: string,
  random: () => number = Math.random,
): string | undefined {
  const others = examples.filter((example) => example !== current.trim());
  return others[Math.floor(random() * others.length)];
}
