/**
 * Characters that show nothing and take no space: zero-width and bidi controls, soft hyphen,
 * grapheme joiner, variation selectors, Hangul and Khmer fillers, the blank Braille cell and
 * Unicode tag characters. `String.trim` leaves them in place, so a text made only of them looks
 * empty to a person yet is not empty to a length check.
 *
 * Shared by request validation and by the moderation normalizer, which removes them before
 * matching so they cannot split a word. Built from escapes in a string because Prettier rewrites
 * escapes in regex literals into the raw (and unreadable) characters.
 */
export const INVISIBLE_CHARS = new RegExp(
  String.raw`[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E01EF}]`,
  'gu',
);

/** `text` without invisible characters and without surrounding whitespace. */
export function visibleText(text: string): string {
  return text.replace(INVISIBLE_CHARS, '').trim();
}

/** True when a person looking at `text` would see something. */
export function hasVisibleText(text: string): boolean {
  return visibleText(text) !== '';
}
