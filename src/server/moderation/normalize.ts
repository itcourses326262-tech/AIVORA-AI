import 'server-only';
import { INVISIBLE_CHARS } from '@/lib/validation/visible-text';
import { markMinorAges } from './age';

/**
 * Text normalization for moderation and for the prompt enhancer's language checks. Moderation
 * matches whole tokens of the normalized text, so everything people use to dodge a word filter
 * (case, accents, fullwidth or math-styled letters, zero-width characters, Arabic diacritics and
 * tatweel, Cyrillic or Greek look-alikes, repeated letters, `l33t`) is folded away here first.
 */

// Combining marks: Latin accents, Arabic harakat, and the hamza/madda marks that NFKD splits off
// أ إ آ ؤ ئ (which also unifies those letters with their plain forms).
const COMBINING_MARKS = /\p{Mn}/gu;
const TATWEEL = /ـ/g;

const LOOKALIKES: Readonly<Record<string, string>> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ѵ: 'v',
  һ: 'h',
  ӏ: 'l',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  ς: 's',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
  // Latin extensions and small capitals
  ı: 'i',
  ɑ: 'a',
  ɡ: 'g',
  ɩ: 'i',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  ħ: 'h',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
  // Arabic letter variants that NFKD leaves alone
  ى: 'ي',
  ی: 'ي',
  ې: 'ي',
  ة: 'ه',
  ہ: 'ه',
  ھ: 'ه',
  ک: 'ك',
  گ: 'ك',
  ٱ: 'ا',
  // Arabic-Indic and Extended Arabic-Indic digits
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};
const LOOKALIKE_PATTERN = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu');

// Regional-indicator emoji spell letters (🇵🇴🇷🇳) without being any letter for NFKD.
const REGIONAL_INDICATORS = /[\u{1F1E6}-\u{1F1FF}]/gu;

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
};
// Digits and `@ $` count as letters when they touch a letter (`s3x`, `5ex`, `p0rn`, `@ss`);
// `! | +` only between two letters, so ordinary punctuation (`wow!`, `a + b`) stays punctuation.
const LEET_EDGE = /(?<=\p{L})[013457@$]|[013457@$](?=\p{L})/gu;
const LEET_INNER = /(?<=\p{L})[!|+](?=\p{L})/gu;

/**
 * Folds `text` to a canonical lowercase form: compatibility characters, accents, invisible
 * characters, Arabic marks, tatweel, look-alike letters and Arabic-Indic digits are unified.
 * Punctuation and spacing are kept; use {@link tokenize} for matching.
 */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(INVISIBLE_CHARS, '')
    .replace(COMBINING_MARKS, '')
    .replace(TATWEEL, '')
    .replace(REGIONAL_INDICATORS, (char) =>
      String.fromCharCode(97 + (char.codePointAt(0) as number) - 0x1f1e6),
    )
    .replace(LOOKALIKE_PATTERN, (char) => LOOKALIKES[char] ?? char);
}

/** Reads leetspeak digits and symbols as the letters they imitate (`p0rn` -> `porn`). */
export function foldLeet(folded: string): string {
  let current = folded;
  // A digit next to a freshly read letter counts too (`h3nt41`), so repeat until stable.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = current
      .replace(LEET_EDGE, (char) => LEET[char] ?? char)
      .replace(LEET_INNER, (char) => LEET[char] ?? char);
    if (next === current) break;
    current = next;
  }
  return current;
}

// Three or more of the same letter are one emphasis (`pooorn`); legitimate doubles stay.
function collapseRepeats(token: string): string {
  return token.replace(/(.)\1{2,}/gu, '$1$1');
}

/** Letters and digits of each word, with repeated-letter emphasis reduced to a double. */
export function tokenize(folded: string): string[] {
  return folded
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '')
    .map(collapseRepeats);
}

/** The token streams a text is matched as: as written, and with leetspeak read as letters. */
export function tokenViews(text: string): string[][] {
  const folded = markMinorAges(foldText(text));
  const plain = tokenize(folded);
  const leetFolded = foldLeet(folded);
  if (leetFolded === folded) return [plain];
  // An age spelled in leetspeak ("th1rteen year old") only reads as one in this second view.
  return [plain, tokenize(markMinorAges(leetFolded))];
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function hasArabicScript(text: string): boolean {
  return ARABIC_LETTER.test(text);
}
