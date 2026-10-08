import 'server-only';
import { foldText, tokenViews } from './normalize';
import type { ModerationCategory } from './terms';
import { MINORS_AR, MINORS_EN, PEOPLE_AR, PEOPLE_EN, PRONOUNS_EN } from './vocabulary';

/**
 * A negative prompt says what to leave out, so "nsfw, nude, child, loli" in it is exactly what
 * people should write and is never moderated like a prompt. What it can still do is steer by
 * exclusion: a portrait of a woman whose negative prompt rules out "clothes, clothing, underwear,
 * bikini" is a request for a nude. This module spots that, and only that.
 */

// Each inner list is one idea, so "bikini, bikinis" counts once while "clothes, clothing" counts
// twice: one mention ("wrinkled clothes") is ordinary, a list of garments is not.
const INVERSION_GROUPS: ReadonlyArray<readonly string[]> = [
  ['clothes'],
  ['clothing', 'clothed'],
  ['dressed'],
  ['garment', 'garments'],
  ['apparel'],
  ['attire'],
  ['outfit', 'outfits'],
  ['underwear', 'underpants'],
  ['panties'],
  ['bra', 'bras', 'brassiere'],
  ['lingerie'],
  ['bikini', 'bikinis'],
  ['swimsuit', 'swimsuits', 'swimwear'],
  ['censored', 'censor', 'censorship'],
  ['mosaic'],
  ['ملابس'],
  ['ثياب'],
  ['لباس'],
  ['مايوه'],
  ['بيكيني', 'بكيني'],
];
// Word lists are written naturally ("امرأة" with its hamza); text is compared folded.
const folded = (word: string): string => foldText(word);

const GROUP_OF = new Map(
  INVERSION_GROUPS.flatMap((words, group) => words.map((word) => [folded(word), group] as const)),
);
const MIN_GROUPS = 2;

/** Single-word person terms; the plural of an English noun counts as well. */
const PERSON_WORDS: ReadonlySet<string> = new Set(
  [...PEOPLE_EN, ...MINORS_EN, ...PRONOUNS_EN, ...PEOPLE_AR, ...MINORS_AR]
    .filter((word) => !word.includes(' '))
    .map(folded)
    .flatMap((word) => (/^[a-z]+$/.test(word) ? [word, `${word}s`, `${word}es`] : [word])),
);

const ARABIC_ARTICLE = /^(?:وال|فال|بال|كال|لل|ال)/u;

function wordsOf(text: string): Set<string> {
  const words = new Set<string>();
  for (const view of tokenViews(text)) {
    for (const token of view) {
      words.add(token);
      words.add(token.replace(ARABIC_ARTICLE, ''));
    }
  }
  return words;
}

export interface NegativePromptContext {
  /** The positive prompt: the exclusion only matters when it can be about a person. */
  prompt?: string;
  /** An uploaded photo is in play, so a person is assumed. */
  hasInputImage?: boolean;
}

/**
 * `sexual_explicit` when the negative prompt excludes clothing by listing several garments while
 * the request is about a person (or may be: no prompt given, or an uploaded photo), else null.
 */
export function negativePromptCategory(
  negativePrompt: string,
  context: NegativePromptContext = {},
): ModerationCategory | null {
  const groups = new Set<number>();
  for (const word of wordsOf(negativePrompt)) {
    const group = GROUP_OF.get(word);
    if (group !== undefined) groups.add(group);
  }
  if (groups.size < MIN_GROUPS) return null;

  const aboutAPerson =
    context.hasInputImage === true ||
    context.prompt === undefined ||
    [...wordsOf(context.prompt)].some((word) => PERSON_WORDS.has(word));
  return aboutAPerson ? 'sexual_explicit' : null;
}
