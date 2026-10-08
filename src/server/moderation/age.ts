import 'server-only';

/**
 * Turns a stated age under 18 ("12 year old", "twelve-year-old", "aged fifteen", "she is 13",
 * "عمرها اربعة عشر") into the word "minor" so the sexual-minors rules see it like any other minor
 * word. Works on text that was already folded by `foldText` (lower case, Arabic letters unified).
 *
 * Only forms that really state an age count. A bare "5 years" is a duration ("5 years later",
 * "10 years of marriage"), so a unit needs "old", "of age" or a person noun after it.
 */

const GAP = '[^\\p{L}\\p{N}]*';
const SEP = '[^\\p{L}\\p{N}]+';
const START = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';

// Added once per match, one marker per language.
const MINOR_MARKERS = ' minor قاصر ';

// One to seventeen; longer words first so "seventeen" is not read as "seven".
const EN_NUMBER_WORDS = [
  'seventeen',
  'sixteen',
  'fifteen',
  'fourteen',
  'thirteen',
  'twelve',
  'eleven',
  'seven',
  'three',
  'eight',
  'nine',
  'four',
  'five',
  'two',
  'one',
  'ten',
  'six',
];
// "twenty-one" and "one hundred and two" are not "one" and "two".
const NOT_AFTER_TENS = `(?<!(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)${GAP})`;
const EN_NUMBER = `\\d{1,2}|${NOT_AFTER_TENS}(?:${EN_NUMBER_WORDS.join('|')})`;

const PERSON_AFTER_YEARS = `(?=${SEP}(?:girls?|boys?|child|children|kids?|babys?|babies|students?|daughters?|sons?)${END})`;
const EN_AGE_UNIT = [
  `years?${GAP}old`,
  `years?${GAP}of${GAP}age`,
  `yrs?${GAP}old`,
  `yrs?${GAP}of${GAP}age`,
  `y[^\\p{L}\\p{N}]?o`,
  `years?${PERSON_AFTER_YEARS}`,
].join('|');
// "6 months old" is an infant whatever the number.
const EN_INFANT_UNIT = `(?:months?|mos?|weeks?|wks?)${GAP}old`;

// Arabic teens (11-17) are two words; 18 and 19 ("ثمانية عشر", "تسعة عشر") are adults, and the
// "عشر" of any teen must not be read as a lone ten.
const AR_TEEN_STEMS =
  'احد|احدي|اثنا|اثني|اثنتا|اثنتي|ثلاثه|ثلاث|اربعه|اربع|خمسه|خمس|سته|ست|سبعه|سبع|ثمانيه|ثماني|ثمان|تسعه|تسع';
const AR_TEENS = `(?:احد|احدي|اثنا|اثني|اثنتا|اثنتي|ثلاثه|ثلاث|اربعه|اربع|خمسه|خمس|سته|ست|سبعه|سبع)${GAP}عشر(?:ه)?`;
const AR_ONES =
  '(?:واحد|واحده|اثنان|اثنين|اثنتان|اثنتين|ثلاثه|ثلاث|اربعه|اربع|خمسه|خمس|سته|ست|سبعه|سبع|ثمانيه|ثماني|ثمان|تسعه|تسع)' +
  `(?!${GAP}عشر)`;
const AR_TEN = `(?<!(?:${AR_TEEN_STEMS})${GAP})عشر(?:ه)?`;
const AR_NUMBER_WORD = `(?:${AR_TEENS}|${AR_ONES}|${AR_TEN})`;
const AR_YEAR_UNIT = '(?:سنه|سنوات|سنين|عاما|عام|اعوام)';
const AR_AGE_WORD = '[وفلب]?(?:عمرها|عمره|عمرهم|عمرهن|عمري|عمر|بعمر)';
// "بعد عشر سنوات" / "10 سنوات من الزواج" are durations; "12 سنة من العمر" is an age.
const AR_NOT_AFTER_DURATION = `(?<!(?:بعد|قبل|منذ|خلال|لمده|مده|مضت|مرت)${GAP})`;
const AR_NOT_A_DURATION = `(?!${GAP}(?:من(?!${GAP}(?:ال)?عمر)|مضت|مرت|لاحقا|ماضيه|قادمه))`;

// Words that follow a number without making it an age ("under 18 dollars", "she is 5 feet tall").
const NOT_AN_AGE_UNIT = `(?!${GAP}(?:o['’]?clock|pm|am|percent|cm|mm|kg|km|ft|feet|foot|inch|inches|lbs?|pounds?|times|minutes?|mins?|hours?|hrs?|days?|dollars?|bucks|euros?|degrees?))`;
const SUBJECT = '(?:she|he|they|girl|boy|child|kid|daughter|son|baby|i|who|that|you|we)';
const BE = `(?:${SEP}(?:is|was|am|are|were|turned|turning|turns)|['’](?:s|m|re))`;

interface AgePattern {
  pattern: RegExp;
  /** Whether the captured number is under 18; absent when every match is a minor. */
  isMinor?: (captured: string) => boolean;
}

const underEighteen = (captured: string): boolean =>
  /^\d+$/u.test(captured) ? Number(captured) < 18 : true;

const AGE_PATTERNS: readonly AgePattern[] = [
  // "12 year old", "twelve-year-old", "12yo", "12 y.o.", "9 yrs old", "12 years girl"
  {
    pattern: new RegExp(`${START}(${EN_NUMBER})${GAP}(?:${EN_AGE_UNIT})${END}`, 'gu'),
    isMinor: underEighteen,
  },
  // "6 months old"
  { pattern: new RegExp(`${START}(\\d{1,2})${GAP}${EN_INFANT_UNIT}${END}`, 'gu') },
  // "aged 9", "age: fifteen", "age of 12"
  {
    pattern: new RegExp(`${START}(?:aged?|ages)${GAP}(?:of${GAP})?(${EN_NUMBER})${END}`, 'gu'),
    isMinor: underEighteen,
  },
  // "she is 13", "girl who is fourteen", "I'm 15", "turning ten"
  {
    pattern: new RegExp(
      `${START}${SUBJECT}${BE}${SEP}(${EN_NUMBER})${END}${NOT_AN_AGE_UNIT}`,
      'gu',
    ),
    isMinor: underEighteen,
  },
  // "under 18", "younger than eighteen"
  {
    pattern: new RegExp(
      `${START}(?:under|below|younger than|less than)${GAP}(?:18|eighteen)${END}${NOT_AN_AGE_UNIT}`,
      'gu',
    ),
  },
  // "12 سنة", "10 سنوات"
  {
    pattern: new RegExp(
      `${AR_NOT_AFTER_DURATION}${START}(\\d{1,2})${GAP}${AR_YEAR_UNIT}${END}${AR_NOT_A_DURATION}`,
      'gu',
    ),
    isMinor: underEighteen,
  },
  // "اربعة عشر عاما", "ثلاث سنوات"
  {
    pattern: new RegExp(
      `${AR_NOT_AFTER_DURATION}${START}${AR_NUMBER_WORD}${GAP}${AR_YEAR_UNIT}${END}${AR_NOT_A_DURATION}`,
      'gu',
    ),
  },
  // "عمرها 10", "بعمر 12", "عمرها اربعة عشر"
  {
    pattern: new RegExp(`${START}${AR_AGE_WORD}${GAP}(\\d{1,2})(?!\\d)`, 'gu'),
    isMinor: underEighteen,
  },
  { pattern: new RegExp(`${START}${AR_AGE_WORD}${GAP}${AR_NUMBER_WORD}${END}`, 'gu') },
  // "اقل من 18", "دون الثامنة عشرة"
  {
    pattern: new RegExp(
      `${START}(?:اقل من|دون|تحت)${GAP}(?:18|(?:ال)?ثمانيه${GAP}عشر(?:ه)?)${END}`,
      'gu',
    ),
  },
];

/** Appends a minor marker after every stated age under 18. */
export function markMinorAges(folded: string): string {
  let text = folded;
  for (const { pattern, isMinor } of AGE_PATTERNS) {
    text = text.replace(pattern, (match: string, captured?: string) =>
      isMinor === undefined || (captured !== undefined && isMinor(captured))
        ? match + MINOR_MARKERS
        : match,
    );
  }
  return text;
}
