import 'server-only';
import { MAX_ENHANCED_CHARS } from './heuristic';

/** Thrown for engine output that cannot be used; the enhancer falls back to the next engine. */
export class EnhancerFailure extends Error {
  override readonly name = 'EnhancerFailure';

  constructor(
    /** Safe to log: never contains the prompt, the response body or a key. */
    readonly reason: string,
  ) {
    super(`Prompt enhancer failed: ${reason}`);
  }
}

const PREAMBLE =
  /^(?:here(?:'s| is| are)|sure|certainly|of course|okay|ok|absolutely|improved|enhanced|rewritten|optimi[sz]ed|final|بالتأكيد|حسنا|إليك|اليك)\b[^\n]{0,100}:$/iu;
const TRAILING_NOTE = /^\(?\s*(?:note|notes|explanation|translation|ملاحظة|ملاحظات)\b/iu;
const LABEL =
  /^(?:(?:improved|enhanced|rewritten|optimi[sz]ed|final|new)\s+)?(?:(?:image|video)\s+)?(?:prompt|description)\s*[:：\-–—]\s*|^(?:الوصف المحسن|الوصف|النص المحسن|البرومبت)\s*[:：]\s*/iu;
const BULLET = /^(?:[-*•>]+|\d{1,2}[.)])\s+/u;
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
  ['„', '“'],
];

function stripWrappingQuotes(text: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }
  return text;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/(?<![\p{L}\p{N}])\*([^*\n]+)\*(?![\p{L}\p{N}])/gu, '$1')
    .replace(/^#{1,6}\s+/u, '')
    .replace(/`/gu, '');
}

function cap(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  const cut = chars.slice(0, maxChars).join('');
  // Prefer ending on a word boundary when that costs little.
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
  const clean = boundary > cut.length * 0.75 ? cut.slice(0, boundary) : cut;
  return clean.replace(/[\s,;:\-–—]+$/u, '');
}

/**
 * Turns raw model output into a bare prompt: no code fences, preamble ("Here is the improved
 * prompt:"), label, markdown, bullets or wrapping quotes, one paragraph, at most `maxChars`
 * characters. Throws {@link EnhancerFailure} when nothing usable is left or the model leaked the
 * system prompt's draft markers.
 */
export function sanitizeEnhancedPrompt(raw: string, maxChars: number = MAX_ENHANCED_CHARS): string {
  if (/<\/?draft\b/iu.test(raw)) throw new EnhancerFailure('leaked_markers');

  let text = raw.replace(/\r\n?/gu, '\n').trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/u.exec(text);
  if (fenced) text = (fenced[1] ?? '').trim();
  text = text.replace(/```[^\n]*/gu, '');

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  while (lines.length > 1 && PREAMBLE.test(lines[0] as string)) lines.shift();
  while (lines.length > 1 && TRAILING_NOTE.test(lines[lines.length - 1] as string)) lines.pop();
  text = lines.join(' ');

  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    text = stripWrappingQuotes(text.replace(BULLET, '').replace(LABEL, '').trim());
    text = stripMarkdown(text).replace(/\s+/gu, ' ').trim();
    if (text === before) break;
  }

  text = cap(text, maxChars);
  if (Array.from(text).length < 3) throw new EnhancerFailure('empty_output');
  return text;
}
