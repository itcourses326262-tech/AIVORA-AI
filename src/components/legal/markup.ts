/**
 * The tiny markup of the legal dictionaries (see the header of `lib/i18n/messages/legal-documents.ts`):
 * paragraphs, bullet lists, `### ` sub-headings, `**bold**`, `[[code]]`, `[label](/path)` and
 * `{token}`. Pure and isomorphic, so tests can check every dictionary without rendering.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'token'; name: string };

export type Block =
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'subheading'; text: string }
  | { type: 'list'; items: Inline[][] };

export interface ParseOptions {
  /** While false, the `{confirm}` flags (and the space before them) are dropped from the text. */
  draft: boolean;
  /** Internal paths a `[label](/path)` may point to; any other target renders as its label only. */
  linkTargets: readonly string[];
}

/** Name of the token that renders the "to confirm" flag. */
export const CONFIRM_TOKEN = 'confirm';

const INLINE = /\*\*(.+?)\*\*|\[\[(.+?)\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\{(\w+)\}/g;

export function parseInline(source: string, options: ParseOptions): Inline[] {
  const out: Inline[] = [];
  const pushText = (text: string) => {
    if (text !== '') out.push({ type: 'text', text });
  };
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    pushText(source.slice(last, match.index));
    last = match.index + match[0].length;
    const [, strong, code, label, href, token] = match;
    if (strong !== undefined) {
      out.push({ type: 'strong', text: strong });
    } else if (code !== undefined) {
      out.push({ type: 'code', text: code });
    } else if (label !== undefined && href !== undefined) {
      if (options.linkTargets.includes(href)) out.push({ type: 'link', label, href });
      else pushText(label);
    } else if (token === CONFIRM_TOKEN && !options.draft) {
      // Take the space in front of the flag with it ("... months {confirm}." -> "... months.").
      const previous = out.at(-1);
      if (previous?.type === 'text') previous.text = previous.text.trimEnd();
    } else if (token !== undefined) {
      out.push({ type: 'token', name: token });
    }
  }
  pushText(source.slice(last));
  return out;
}

/** Splits a section body into blocks. Lines are trimmed, so the source may be indented freely. */
export function parseMarkup(source: string, options: ParseOptions): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[][] | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' '), options) });
    }
    if (list) {
      blocks.push({
        type: 'list',
        items: list.map((lines) => parseInline(lines.join(' '), options)),
      });
    }
    paragraph = [];
    list = null;
  };

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
    } else if (line.startsWith('### ')) {
      flush();
      blocks.push({ type: 'subheading', text: line.slice(4).trim() });
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0) flush();
      list ??= [];
      list.push([line.slice(2).trim()]);
    } else if (list) {
      // A line without a bullet continues the item above it.
      list.at(-1)?.push(line);
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/**
 * Fills the `{name}` placeholders that have a value in `values` and leaves every other one (the
 * company details, `{confirm}`) for the renderer. Values are used as they are: they arrive already
 * formatted for the language (digits, plural words), so the text never types a unit after them.
 */
export function fillVariables(source: string, values: Readonly<Record<string, string>>): string {
  return source.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? placeholder) : placeholder,
  );
}
