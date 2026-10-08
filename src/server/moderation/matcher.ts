import 'server-only';
import { foldText, tokenViews, tokenize } from './normalize';
import {
  COMBO_RULES,
  INPUT_IMAGE_TERM_RULES,
  MODERATION_CATEGORIES,
  NOT_SPELLED_OUT,
  SAFE_PHRASES,
  TERM_RULES,
  type ModerationCategory,
} from './terms';

/** An Arabic word may carry one-letter clitics and the article: وللمسلمين, بالسكس. */
const ARABIC_CLITICS = '(?:وال|فال|بال|كال|ولل|لل|ال|و|ف|ب|ك|ل)?';
const MAX_JOIN_TOKENS = 12;
const MAX_JOINED_SHORT_TOKEN = 3;

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isArabicWord(word: string): boolean {
  return /\p{Script=Arabic}/u.test(word);
}

/**
 * Anchored pattern for one normalized word. A letter may appear once or twice (`porn`, `poorn`:
 * runs of three or more were already reduced to two), a letter the word doubles must stay double
 * (so `ass` never matches `as`), English words also match `+s`/`+es`, Arabic words take clitics.
 */
function wordPattern(word: string): RegExp {
  let body = '';
  for (const run of word.match(/(.)\1*/gu) ?? []) {
    const char = escapeRegex(Array.from(run)[0] as string);
    body += Array.from(run).length >= 2 ? `${char}{2}` : `${char}{1,2}`;
  }
  const prefix = isArabicWord(word) ? ARABIC_CLITICS : '';
  const suffix = /^[a-z]+$/.test(word) ? '(?:s|es)?' : '';
  return new RegExp(`^${prefix}${body}${suffix}$`, 'u');
}

/** Normalizes a rule entry to its words, e.g. `'Under-Age'` -> `['under', 'age']`. */
function wordsOf(entry: string): string[] {
  return tokenize(foldText(entry));
}

/** Every distinct word of every rule, with an id, and a way to ask which words a token matches. */
class WordIndex {
  private readonly patterns: RegExp[] = [];
  private readonly ids = new Map<string, number>();
  private readonly byFirstLetter = new Map<string, number[]>();
  private readonly arabic: number[] = [];
  private readonly other: number[] = [];
  readonly vocabulary = new Set<string>();

  add(word: string): number {
    const known = this.ids.get(word);
    if (known !== undefined) return known;
    const id = this.patterns.length;
    this.patterns.push(wordPattern(word));
    this.ids.set(word, id);
    this.vocabulary.add(word);
    if (/^[a-z]+$/.test(word)) {
      this.vocabulary.add(`${word}s`);
      this.vocabulary.add(`${word}es`);
    }
    if (isArabicWord(word)) this.arabic.push(id);
    else if (/^[a-z]/.test(word)) {
      const key = word.charAt(0);
      const bucket = this.byFirstLetter.get(key);
      if (bucket) bucket.push(id);
      else this.byFirstLetter.set(key, [id]);
    } else this.other.push(id);
    return id;
  }

  matches(token: string): number[] {
    if (token === '') return [];
    const candidates = [
      ...(this.byFirstLetter.get(token.charAt(0)) ?? []),
      ...(isArabicWord(token) ? this.arabic : []),
      ...this.other,
    ];
    return candidates.filter((id) => (this.patterns[id] as RegExp).test(token));
  }
}

type Phrase = number[];

interface CompiledCombo {
  window: number;
  a: Phrase[];
  b: Phrase[];
  c?: Phrase[];
}

interface CompiledCategory {
  category: ModerationCategory;
  terms: Phrase[];
  combos: CompiledCombo[];
}

interface Span {
  start: number;
  end: number;
}

/** Where each word id occurs in a token stream, and the ids each token matches. */
interface Occurrences {
  matches: number[][];
  positions: Map<number, number[]>;
}

function occurrencesIn(tokens: readonly string[], index: WordIndex): Occurrences {
  const cache = new Map<string, number[]>();
  const positions = new Map<number, number[]>();
  const matches = tokens.map((token, position) => {
    let ids = cache.get(token);
    if (!ids) {
      ids = index.matches(token);
      cache.set(token, ids);
    }
    for (const id of ids) {
      const list = positions.get(id);
      if (list) list.push(position);
      else positions.set(id, [position]);
    }
    return ids;
  });
  return { matches, positions };
}

function spansOf(phrase: Phrase, found: Occurrences): Span[] {
  const first = phrase[0];
  if (first === undefined) return [];
  const spans: Span[] = [];
  for (const start of found.positions.get(first) ?? []) {
    const fits = phrase.every((id, offset) => found.matches[start + offset]?.includes(id));
    if (fits) spans.push({ start, end: start + phrase.length });
  }
  return spans;
}

function near(a: Span, b: Span, window: number): boolean {
  if (a.start < b.end && b.start < a.end) return false;
  const gap = a.end <= b.start ? b.start - a.end : a.start - b.end;
  return gap <= window;
}

function comboHits(combo: CompiledCombo, found: Occurrences): boolean {
  const left = combo.a.flatMap((phrase) => spansOf(phrase, found));
  if (left.length === 0) return false;
  const right = combo.b.flatMap((phrase) => spansOf(phrase, found));
  const third = combo.c?.flatMap((phrase) => spansOf(phrase, found));
  if (third?.length === 0) return false;
  return left.some((a) =>
    right.some(
      (b) =>
        near(a, b, combo.window) &&
        (third === undefined ||
          third.some((c) => near(c, a, combo.window) || near(c, b, combo.window))),
    ),
  );
}

/**
 * Joins runs of very short tokens that spell a known word (`p o r n`, `s-e-x`, `po rn`) into
 * that word. Only joins that land exactly on a rule word count, so ordinary text is untouched,
 * and `harmless` lists the few everyday word pairs that happen to do so ("pen is" -> "penis").
 */
function joinSpelledOut(
  tokens: readonly string[],
  vocabulary: ReadonlySet<string>,
  harmless: ReadonlySet<string>,
): string[] {
  // runEnd[i] is where the run of short tokens that starts at i stops. Computing it once keeps
  // the whole pass linear however long a run of single letters is.
  const runEnd = new Array<number>(tokens.length + 1).fill(tokens.length);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    runEnd[i] =
      (tokens[i] as string).length <= MAX_JOINED_SHORT_TOKEN ? (runEnd[i + 1] as number) : i;
  }

  const out: string[] = [];
  let position = 0;
  while (position < tokens.length) {
    let joined = false;
    const longest = Math.min(runEnd[position] as number, position + MAX_JOIN_TOKENS);
    for (let end = longest; end >= position + 2; end -= 1) {
      const run = tokens.slice(position, end);
      const candidate = run.join('');
      if (vocabulary.has(candidate) && !harmless.has(run.join(' '))) {
        out.push(candidate);
        position = end;
        joined = true;
        break;
      }
    }
    if (!joined) {
      out.push(tokens[position] as string);
      position += 1;
    }
  }
  return out;
}

export interface LocalCheckOptions {
  /** The request edits an uploaded photo: any nudity word counts as undressing its subject. */
  hasInputImage?: boolean;
}

export interface LocalMatcher {
  /** The most serious category the text falls into, or null. Never returns the matched text. */
  check(text: string, options?: LocalCheckOptions): ModerationCategory | null;
}

/**
 * Compiles the built-in rules plus `extraTerms` (the `MODERATION_BLOCKLIST` entries, which
 * become the `blocklist` category) into a matcher.
 */
export function createLocalMatcher(extraTerms: readonly string[] = []): LocalMatcher {
  const index = new WordIndex();
  const compile = (entry: string): Phrase => wordsOf(entry).map((word) => index.add(word));
  const compileAll = (entries: readonly string[]): Phrase[] =>
    entries.map(compile).filter((phrase) => phrase.length > 0);

  const compileCategories = (withInputImageRules: boolean): CompiledCategory[] =>
    MODERATION_CATEGORIES.map((category) => ({
      category,
      terms: [
        ...TERM_RULES.filter((rule) => rule.category === category).flatMap((rule) =>
          compileAll(rule.terms),
        ),
        ...(category === 'blocklist' ? compileAll(extraTerms) : []),
        ...(withInputImageRules
          ? INPUT_IMAGE_TERM_RULES.filter((rule) => rule.category === category).flatMap((rule) =>
              compileAll(rule.terms),
            )
          : []),
      ],
      combos: COMBO_RULES.filter((rule) => rule.category === category).map((rule) => ({
        window: rule.window,
        a: compileAll(rule.a),
        b: compileAll(rule.b),
        ...(rule.c === undefined ? {} : { c: compileAll(rule.c) }),
      })),
    }));
  const textCategories = compileCategories(false);
  const imageCategories = compileCategories(true);
  const safePhrases = compileAll(SAFE_PHRASES);
  const harmlessPairs = new Set(NOT_SPELLED_OUT.map((entry) => wordsOf(entry).join(' ')));

  function categoryOf(tokens: readonly string[], categories: readonly CompiledCategory[]): number {
    const found = occurrencesIn(tokens, index);
    // Known harmless phrases ("Al Gore", "Gore-Tex") are blanked, not trusted: the same word
    // anywhere else in the prompt still counts.
    const blanked = [...tokens];
    for (const phrase of safePhrases) {
      for (const { start, end } of spansOf(phrase, found)) blanked.fill('', start, end);
    }
    const clean = blanked.some((token, position) => token !== tokens[position])
      ? occurrencesIn(blanked, index)
      : found;

    for (const [rank, compiled] of categories.entries()) {
      if (compiled.terms.some((phrase) => spansOf(phrase, clean).length > 0)) return rank;
      if (compiled.combos.some((combo) => comboHits(combo, clean))) return rank;
    }
    return Number.POSITIVE_INFINITY;
  }

  return {
    check(text, options = {}) {
      const categories = options.hasInputImage ? imageCategories : textCategories;
      let best = Number.POSITIVE_INFINITY;
      for (const view of tokenViews(text)) {
        const spelled = joinSpelledOut(view, index.vocabulary, harmlessPairs);
        const streams = spelled.length === view.length ? [view] : [view, spelled];
        for (const stream of streams) {
          best = Math.min(best, categoryOf(stream, categories));
          if (best === 0) break;
        }
        if (best === 0) break;
      }
      return MODERATION_CATEGORIES[best] ?? null;
    },
  };
}

const matchers = new Map<string, LocalMatcher>();
const MAX_CACHED_MATCHERS = 8;

/** A compiled matcher for this blocklist, reused across calls (compiling takes a few ms). */
export function getLocalMatcher(extraTerms: readonly string[] = []): LocalMatcher {
  const key = extraTerms.join('\u0000');
  const cached = matchers.get(key);
  if (cached) return cached;
  const created = createLocalMatcher(extraTerms);
  if (matchers.size >= MAX_CACHED_MATCHERS) {
    const oldest = matchers.keys().next().value;
    if (oldest !== undefined) matchers.delete(oldest);
  }
  matchers.set(key, created);
  return created;
}
