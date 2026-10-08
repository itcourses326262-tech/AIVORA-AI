import 'server-only';
import type { EnhancePromptRequest, EnhancePromptResponse } from '@/lib/api-types';
import type { Kind } from '@/lib/catalog/types';
import type { Locale } from '@/lib/i18n/locales';
import { foldText } from '@/server/moderation/normalize';
import { arabicLetterRatio } from './text';

/** Output cap shared with the LLM engines; the user's own words are never cut to fit it. */
export const MAX_ENHANCED_CHARS = 1000;

export interface Descriptor {
  /** Matched against the folded prompt: if it hits, the user already covered this aspect. */
  present: RegExp;
  en: string;
  ar: string;
}

// Each phrase must satisfy its own `present` pattern, which is what makes enhancing idempotent:
// a second pass finds every aspect covered and changes nothing (tests assert this per phrase).
const IMAGE_DESCRIPTORS: readonly Descriptor[] = [
  {
    present:
      /\b(?:light|lighting|lit|glow\w*|sunlight|sunset|sunrise|golden hour|backlit|neon|shadows?|illuminat\w*|ambient)|اضاء|ضوء|اضواء|نور|وهج|غروب|شروق|ظلال/,
    en: 'soft cinematic lighting',
    ar: 'إضاءة سينمائية ناعمة',
  },
  {
    present:
      /\b(?:composition|framing|close[- ]?up|wide[- ]?angle|bird'?s[- ]?eye|symmetr\w*|centered|depth of field|bokeh|macro|panoramic|aerial view|overhead|low angle|high angle)|تكوين|زاويه|لقطه|مقرب|منظور|عمق الميدان/,
    en: 'balanced composition',
    ar: 'تكوين متوازن',
  },
  {
    present:
      /\b(?:colou?rs?|colou?rful|palette|vibrant|vivid|pastel|monochrome|muted|warm tones?|cool tones?|black and white)|لون|الوان|زاهي|باستيل|دافئ/,
    en: 'harmonious color palette',
    ar: 'ألوان متناسقة',
  },
  {
    present:
      /\b(?:details?|detailed|sharp|focus|high[- ]?quality|high[- ]?resolution|\d+k|hd|uhd|ultra|photorealistic|hyper[- ]?realistic|intricate)|تفاصيل|تفصيل|دقيق|حاد|جوده عاليه|دقه عاليه|واقعي/,
    en: 'highly detailed, sharp focus',
    ar: 'تفاصيل دقيقة وتركيز حاد',
  },
];

const VIDEO_DESCRIPTORS: readonly Descriptor[] = [
  {
    present:
      /\b(?:camera|pan|panning|tilt|zoom\w*|dolly|tracking|drone|aerial|handheld|steadicam|orbit\w*|push[- ]?in|pull[- ]?out|crane|travelling|traveling|rotat\w*)|كاميرا|عدسه|تقريب|بانوراما|درون|طائره مسيره|تتبع|دوران/,
    en: 'slow cinematic camera movement',
    ar: 'حركة كاميرا سينمائية بطيئة',
  },
  {
    present:
      /\b(?:motion|moving|slow[- ]?motion|time[- ]?lapse|pacing|fluid|smooth\w*|speed|steady|gentle\w*)|حركه|يتحرك|متحرك|بطيء|سلس|ايقاع|انسيابي|تدفق/,
    en: 'smooth, natural motion',
    ar: 'حركة سلسة وطبيعية',
  },
  {
    present:
      /\b(?:light|lighting|lit|glow\w*|sunlight|sunset|sunrise|golden hour|backlit|neon|shadows?|illuminat\w*|ambient)|اضاء|ضوء|اضواء|نور|وهج|غروب|شروق|ظلال/,
    en: 'soft cinematic lighting',
    ar: 'إضاءة سينمائية ناعمة',
  },
  {
    present:
      /\b(?:details?|detailed|sharp|high[- ]?quality|high[- ]?resolution|\d+k|hd|uhd|stable|consistent|photorealistic|hyper[- ]?realistic)|تفاصيل|تفصيل|دقيق|حاد|جوده عاليه|دقه عاليه|ثابت|متسق|واقعي/,
    en: 'rich detail, stable frames',
    ar: 'تفاصيل غنية وإطارات ثابتة',
  },
];

export const HEURISTIC_DESCRIPTORS: Readonly<Record<Kind, readonly Descriptor[]>> = {
  image: IMAGE_DESCRIPTORS,
  video: VIDEO_DESCRIPTORS,
};

export type DescriptorLanguage = 'en' | 'ar';

/** The user's language: whichever script dominates the letters; the locale decides a tie. */
function languageOf(prompt: string, locale: Locale | undefined): DescriptorLanguage {
  const ratio = arabicLetterRatio(prompt);
  if (ratio > 0.5) return 'ar';
  if (ratio > 0 || /\p{L}/u.test(prompt)) return 'en';
  return locale === 'ar' ? 'ar' : 'en';
}

const TRAILING_PUNCTUATION = /[\s.,;:!?…،؛؟]+$/u;

/**
 * The no-key, no-network enhancer: appends tasteful descriptors suited to the kind (image or
 * video) and never changes the user's own words. Only aspects the prompt does not already cover
 * are added, so enhancing an enhanced prompt returns it unchanged. Descriptors follow the
 * prompt's language. Always `engine: 'heuristic'`, `translated: false`.
 */
export function enhanceHeuristically(input: EnhancePromptRequest): EnhancePromptResponse {
  const text = input.prompt.trim();
  const result = (prompt: string): EnhancePromptResponse => ({
    prompt,
    engine: 'heuristic',
    translated: false,
  });

  const base = text.replace(TRAILING_PUNCTUATION, '');
  if (base === '') return result(text);

  const folded = foldText(text);
  const language = languageOf(text, input.locale);
  const separator = language === 'ar' ? '،' : ',';
  const missing = HEURISTIC_DESCRIPTORS[input.kind]
    .filter((descriptor) => !descriptor.present.test(folded))
    .map((descriptor) => descriptor[language]);

  // Drop the least important descriptors (the last ones) rather than exceed the output cap.
  while (missing.length > 0) {
    const candidate = `${base}${separator} ${missing.join(`${separator} `)}`;
    if (Array.from(candidate).length <= MAX_ENHANCED_CHARS) return result(candidate);
    missing.pop();
  }
  return result(text);
}
