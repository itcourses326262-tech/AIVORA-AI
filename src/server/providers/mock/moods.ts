import 'server-only';
import type { Scheme } from './color';

export const ART_STYLES = ['aurora', 'horizon', 'orbit', 'ribbons'] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

/** A colour and composition bias suggested by words in the prompt (English and Arabic). */
export interface Mood {
  hue: number;
  chroma: number;
  lightness: number;
  dark: boolean;
  scheme?: Scheme;
  styles: readonly [ArtStyle, ...ArtStyle[]];
}

interface MoodRule extends Mood {
  words: readonly string[];
}

const RULES: readonly MoodRule[] = [
  {
    words: [
      'sunset',
      'sunrise',
      'dawn',
      'dusk',
      'fire',
      'lava',
      'flame',
      'غروب',
      'شروق',
      'فجر',
      'نار',
      'حمم',
      'شمس',
    ],
    hue: 38,
    chroma: 1.1,
    lightness: 0.02,
    dark: true,
    scheme: 'analogous',
    styles: ['horizon', 'aurora'],
  },
  {
    words: [
      'ocean',
      'sea',
      'wave',
      'beach',
      'river',
      'lake',
      'water',
      'underwater',
      'بحر',
      'محيط',
      'موج',
      'شاطئ',
      'نهر',
      'بحيرة',
      'ماء',
    ],
    hue: 245,
    chroma: 1,
    lightness: 0.02,
    dark: true,
    scheme: 'analogous',
    styles: ['horizon', 'ribbons'],
  },
  {
    words: [
      'forest',
      'jungle',
      'tree',
      'garden',
      'nature',
      'moss',
      'leaf',
      'plant',
      'غابة',
      'شجر',
      'حديقة',
      'طبيعة',
      'نبات',
      'أخضر',
      'خضر',
    ],
    hue: 150,
    chroma: 0.95,
    lightness: 0,
    dark: true,
    scheme: 'analogous',
    styles: ['horizon', 'aurora'],
  },
  {
    words: [
      'night',
      'space',
      'galaxy',
      'star',
      'moon',
      'cosmos',
      'nebula',
      'planet',
      'ليل',
      'فضاء',
      'مجرة',
      'نجم',
      'نجوم',
      'قمر',
      'كون',
      'كوكب',
    ],
    hue: 288,
    chroma: 1.05,
    lightness: -0.02,
    dark: true,
    scheme: 'split',
    styles: ['orbit', 'aurora'],
  },
  {
    words: [
      'desert',
      'sand',
      'dune',
      'gold',
      'camel',
      'sahara',
      'صحراء',
      'رمال',
      'رمل',
      'كثبان',
      'ذهب',
      'جمل',
    ],
    hue: 72,
    chroma: 0.9,
    lightness: 0.05,
    dark: false,
    scheme: 'analogous',
    styles: ['horizon', 'orbit'],
  },
  {
    words: [
      'snow',
      'ice',
      'winter',
      'frost',
      'arctic',
      'cold',
      'ثلج',
      'جليد',
      'شتاء',
      'صقيع',
      'برد',
    ],
    hue: 238,
    chroma: 0.55,
    lightness: 0.06,
    dark: false,
    scheme: 'analogous',
    styles: ['horizon', 'ribbons'],
  },
  {
    words: [
      'flower',
      'rose',
      'pink',
      'love',
      'spring',
      'blossom',
      'candy',
      'وردة',
      'ورد',
      'زهرة',
      'زهور',
      'حب',
      'ربيع',
    ],
    hue: 352,
    chroma: 1,
    lightness: 0.05,
    dark: false,
    scheme: 'split',
    styles: ['aurora', 'ribbons'],
  },
  {
    words: [
      'neon',
      'cyberpunk',
      'city',
      'robot',
      'future',
      'tech',
      'synthwave',
      'نيون',
      'مدينة',
      'سايبر',
      'مستقبل',
      'روبوت',
      'تقنية',
    ],
    hue: 322,
    chroma: 1.15,
    lightness: -0.02,
    dark: true,
    scheme: 'complementary',
    styles: ['ribbons', 'orbit'],
  },
];

// Arabic is matched without diacritics, tatweel and alef/yaa variants so a definite article or a vowel mark does not hide the keyword.
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A');
}

const ARABIC = /[\u0600-\u06FF]/;

const NORMALIZED_RULES = RULES.map((rule) => ({
  rule,
  words: rule.words.map((word) => ({ text: normalize(word), arabic: ARABIC.test(word) })),
}));

/** Latin words match whole tokens (plus a plural "s"/"es"); Arabic ones match anywhere to survive "ال" and other prefixes. */
function mentions(
  text: string,
  tokens: ReadonlySet<string>,
  word: { text: string; arabic: boolean },
) {
  if (word.arabic) return text.includes(word.text);
  return tokens.has(word.text) || tokens.has(`${word.text}s`) || tokens.has(`${word.text}es`);
}

/** The mood with the most keyword hits in the prompt, or `undefined` when no keyword appears. */
export function detectMood(prompt: string): Mood | undefined {
  const text = normalize(prompt);
  const tokens = new Set(text.split(/[^\p{L}\p{N}]+/u));
  let best: { rule: MoodRule; hits: number } | undefined;
  for (const { rule, words } of NORMALIZED_RULES) {
    const hits = words.reduce((count, word) => count + (mentions(text, tokens, word) ? 1 : 0), 0);
    if (hits > (best?.hits ?? 0)) best = { rule, hits };
  }
  if (!best) return undefined;
  const { words: _words, ...mood } = best.rule;
  return mood;
}
