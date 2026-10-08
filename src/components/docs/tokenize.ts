/**
 * A tiny syntax highlighter for the four languages of the documentation (shell with cURL,
 * JavaScript, Python and JSON): an ordered list of sticky regular expressions per language, tried at
 * every position. It does not parse anything; it only has to colour short, well-formed snippets,
 * and it never changes the text: joining the tokens always gives the input back.
 */

export type CodeLanguage = 'bash' | 'javascript' | 'python' | 'json';

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'property'
  | 'function'
  | 'punctuation'
  | 'flag'
  | 'variable'
  | 'command';

export interface Token {
  kind: TokenKind;
  text: string;
}

export type CodeLine = readonly Token[];

interface Rule {
  kind: TokenKind;
  pattern: RegExp;
}

const rule = (kind: TokenKind, source: string): Rule => ({
  kind,
  pattern: new RegExp(source, 'y'),
});

const NUMBER = String.raw`(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])`;
const DOUBLE_QUOTED = String.raw`"(?:[^"\\\n]|\\.)*"`;
const SINGLE_QUOTED = String.raw`'(?:[^'\\\n]|\\.)*'`;

const JSON_RULES: readonly Rule[] = [
  rule('property', `${DOUBLE_QUOTED}(?=\\s*:)`),
  rule('string', DOUBLE_QUOTED),
  rule('number', NUMBER),
  rule('keyword', String.raw`\b(?:true|false|null)\b`),
  rule('punctuation', String.raw`[{}\[\],:]`),
];

const JS_KEYWORDS =
  'const|let|var|await|async|function|return|if|else|for|while|of|in|new|throw|try|catch|finally|import|from|export|default|class|break|continue|typeof|true|false|null|undefined';

const JAVASCRIPT_RULES: readonly Rule[] = [
  rule('comment', String.raw`//[^\n]*|/\*[\s\S]*?\*/`),
  rule('string', `${DOUBLE_QUOTED}|${SINGLE_QUOTED}|\`(?:[^\`\\\\]|\\\\[\\s\\S])*\``),
  rule('number', NUMBER),
  rule('keyword', String.raw`\b(?:${JS_KEYWORDS})\b`),
  rule('function', String.raw`[A-Za-z_$][\w$]*(?=\s*\()`),
  rule('property', String.raw`(?<=\.)[A-Za-z_$][\w$]*`),
  rule('plain', String.raw`[A-Za-z_$][\w$]*`),
  rule('punctuation', String.raw`[{}()\[\];,.:<>=+\-*/%!?&|]+`),
];

const PY_KEYWORDS =
  'import|from|def|return|if|elif|else|for|while|in|not|and|or|is|with|as|try|except|finally|raise|class|pass|break|continue|lambda|True|False|None';

const PYTHON_RULES: readonly Rule[] = [
  rule('comment', String.raw`#[^\n]*`),
  rule(
    'string',
    String.raw`[fFrRbB]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`,
  ),
  rule('number', NUMBER),
  rule('keyword', String.raw`\b(?:${PY_KEYWORDS})\b`),
  rule('function', String.raw`[A-Za-z_]\w*(?=\s*\()`),
  rule('property', String.raw`(?<=\.)[A-Za-z_]\w*`),
  rule('plain', String.raw`[A-Za-z_]\w*`),
  rule('punctuation', String.raw`[{}()\[\];,.:<>=+\-*/%!&|@]+`),
];

const BASH_RULES: readonly Rule[] = [
  rule('comment', String.raw`(?<=^|\s)#[^\n]*`),
  rule('string', String.raw`"(?:[^"\\]|\\[\s\S])*"|'[^']*'`),
  rule('variable', String.raw`\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$\(`),
  rule('flag', String.raw`(?<=\s)--?[A-Za-z][\w-]*`),
  rule('keyword', String.raw`\b(?:while|do|done|if|then|else|fi|case|esac|for|in)\b`),
  rule('command', String.raw`\b(?:curl|jq|sleep|echo|export|cat|mkdir|head)\b`),
  rule('plain', String.raw`[A-Za-z_][\w.-]*`),
  rule('punctuation', String.raw`\\(?=\n)|[|&;<>(){}=]+|\)`),
];

const RULES: Record<CodeLanguage, readonly Rule[]> = {
  json: JSON_RULES,
  javascript: JAVASCRIPT_RULES,
  python: PYTHON_RULES,
  bash: BASH_RULES,
};

function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (text === '') return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind && (kind === 'plain' || kind === 'punctuation')) {
    tokens[tokens.length - 1] = { kind, text: last.text + text };
  } else {
    tokens.push({ kind, text });
  }
}

/** A single-quoted shell string that holds JSON (`-d '{...}'`) is coloured as JSON inside quotes. */
function splitJsonString(text: string): Token[] | undefined {
  if (!text.startsWith("'") || !text.endsWith("'") || text.length < 4) return undefined;
  const inner = text.slice(1, -1);
  try {
    JSON.parse(inner);
  } catch {
    return undefined;
  }
  return [{ kind: 'string', text: "'" }, ...scan(inner, JSON_RULES), { kind: 'string', text: "'" }];
}

function scan(source: string, rules: readonly Rule[]): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    let matched = false;
    for (const { kind, pattern } of rules) {
      pattern.lastIndex = position;
      const match = pattern.exec(source);
      if (!match || match.index !== position || match[0] === '') continue;
      const json =
        rules === BASH_RULES && kind === 'string' ? splitJsonString(match[0]) : undefined;
      if (json) for (const token of json) push(tokens, token.kind, token.text);
      else push(tokens, kind, match[0]);
      position += match[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      push(tokens, 'plain', source.charAt(position));
      position += 1;
    }
  }
  return tokens;
}

/** Splits tokens at line breaks, so a block can render one line per element. */
function toLines(tokens: readonly Token[]): CodeLine[] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1]?.push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

/** The highlighted lines of `code`. Joining their texts with `\n` gives `code` back. */
export function highlight(code: string, language: CodeLanguage): CodeLine[] {
  return toLines(scan(code, RULES[language]));
}
