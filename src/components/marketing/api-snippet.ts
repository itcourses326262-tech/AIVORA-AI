/**
 * The cURL example of the developer section, as tokens so it can be highlighted and, from the very
 * same tokens, copied as plain text: what people see is exactly what lands in their clipboard.
 */

export type TokenKind = 'command' | 'flag' | 'string' | 'key' | 'number' | 'punctuation' | 'plain';

export interface CodeToken {
  kind: TokenKind;
  text: string;
}

export type CodeLine = readonly CodeToken[];

const tok = (kind: TokenKind, text: string): CodeToken => ({ kind, text });

export interface SnippetOptions {
  /** Origin of this deployment, e.g. `https://aivore.example`. */
  origin: string;
  modelId: string;
  /** Credits the request would cost, shown in the sample response. */
  cost: number;
}

export function requestLines({ origin, modelId }: SnippetOptions): CodeLine[] {
  const cont = tok('punctuation', ' \\');
  return [
    [
      tok('command', 'curl'),
      tok('plain', ' '),
      tok('flag', '-X'),
      tok('plain', ' POST '),
      tok('string', `${origin}/api/v1/generations`),
      cont,
    ],
    [
      tok('plain', '  '),
      tok('flag', '-H'),
      tok('plain', ' '),
      tok('string', '"Authorization: Bearer $AIVORE_API_KEY"'),
      cont,
    ],
    [
      tok('plain', '  '),
      tok('flag', '-H'),
      tok('plain', ' '),
      tok('string', '"Content-Type: application/json"'),
      cont,
    ],
    [tok('plain', '  '), tok('flag', '-d'), tok('plain', ' '), tok('string', "'{")],
    [
      tok('string', '    '),
      tok('key', '"tool"'),
      tok('punctuation', ': '),
      tok('string', '"text-to-image"'),
      tok('punctuation', ','),
    ],
    [
      tok('string', '    '),
      tok('key', '"modelId"'),
      tok('punctuation', ': '),
      tok('string', `"${modelId}"`),
      tok('punctuation', ','),
    ],
    [
      tok('string', '    '),
      tok('key', '"prompt"'),
      tok('punctuation', ': '),
      tok('string', '"A lighthouse at dawn, soft fog, cinematic"'),
      tok('punctuation', ','),
    ],
    [
      tok('string', '    '),
      tok('key', '"params"'),
      tok('punctuation', ': { '),
      tok('key', '"aspectRatio"'),
      tok('punctuation', ': '),
      tok('string', '"16:9"'),
      tok('punctuation', ' }'),
    ],
    [tok('string', "  }'")],
  ];
}

export function responseLines({ cost }: SnippetOptions): CodeLine[] {
  return [
    [tok('punctuation', '{')],
    [tok('plain', '  '), tok('key', '"data"'), tok('punctuation', ': {')],
    [
      tok('plain', '    '),
      tok('key', '"id"'),
      tok('punctuation', ': '),
      tok('string', '"gen_01k3f9x2…"'),
      tok('punctuation', ','),
    ],
    [
      tok('plain', '    '),
      tok('key', '"status"'),
      tok('punctuation', ': '),
      tok('string', '"queued"'),
      tok('punctuation', ','),
    ],
    [
      tok('plain', '    '),
      tok('key', '"cost"'),
      tok('punctuation', ': '),
      tok('number', String(cost)),
    ],
    [tok('plain', '  '), tok('punctuation', '}')],
    [tok('punctuation', '}')],
  ];
}

/** Plain text of highlighted lines, ready for the clipboard. */
export function snippetText(lines: readonly CodeLine[]): string {
  return lines.map((line) => line.map((token) => token.text).join('')).join('\n');
}
