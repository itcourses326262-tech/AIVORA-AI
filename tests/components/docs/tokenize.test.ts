import { describe, expect, it } from 'vitest';
import {
  highlight,
  type CodeLanguage,
  type CodeLine,
  type TokenKind,
} from '@/components/docs/tokenize';

const textOf = (lines: readonly CodeLine[]) =>
  lines.map((line) => line.map((token) => token.text).join('')).join('\n');

const kindsOf = (code: string, language: CodeLanguage, kind: TokenKind) =>
  highlight(code, language)
    .flat()
    .filter((token) => token.kind === kind)
    .map((token) => token.text);

describe('highlight', () => {
  const samples: Record<CodeLanguage, string> = {
    bash: `# comment
export KEY="avk_..."
curl -s -X POST "$BASE/generations" \\
  -H "Content-Type: application/json" \\
  -d '{ "prompt": "a \\" b", "n": 3 }' | jq -r '.data.id'
while true; do sleep 2; done`,
    javascript: `const x = await fetch(\`\${base}/a\`, { method: "POST" }); // done
/* block */ if (x.ok) { console.log(1.5e3, true, null); }`,
    python: `import os  # comment
def f(a, b=None):
    return f"{a}" + 'b' + """doc
string"""
print(f(1, True))`,
    json: `{ "a": [1, -2.5, true, null], "b": { "c": "d\\n" } }`,
  };

  it.each(Object.entries(samples))('never changes the text (%s)', (language, code) => {
    expect(textOf(highlight(code, language as CodeLanguage))).toBe(code);
  });

  it('splits into one entry per line, keeping empty lines', () => {
    const lines = highlight('a\n\nb', 'javascript');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual([]);
  });

  it('colours JSON keys apart from string values', () => {
    expect(kindsOf('{"a": "b", "c": 1, "d": null}', 'json', 'property')).toEqual([
      '"a"',
      '"c"',
      '"d"',
    ]);
    expect(kindsOf('{"a": "b", "c": 1, "d": null}', 'json', 'string')).toEqual(['"b"']);
    expect(kindsOf('{"a": "b", "c": 1, "d": null}', 'json', 'number')).toEqual(['1']);
    expect(kindsOf('{"a": "b", "c": 1, "d": null}', 'json', 'keyword')).toEqual(['null']);
  });

  it('recognises the parts of a cURL command', () => {
    const code = `curl -s -X POST "$BASE_URL/generations" -H "Authorization: Bearer $KEY" # note`;
    expect(kindsOf(code, 'bash', 'command')).toEqual(['curl']);
    expect(kindsOf(code, 'bash', 'flag')).toEqual(['-s', '-X', '-H']);
    expect(kindsOf(code, 'bash', 'string')).toEqual([
      '"$BASE_URL/generations"',
      '"Authorization: Bearer $KEY"',
    ]);
    expect(kindsOf(code, 'bash', 'comment')).toEqual(['# note']);
    expect(kindsOf('export A=$HOME/x ${B}', 'bash', 'variable')).toEqual(['$HOME', '${B}']);
  });

  it('colours the JSON inside a single-quoted shell string as JSON', () => {
    const tokens = highlight(`-d '{"tool": "text-to-image", "n": 2}'`, 'bash').flat();
    expect(tokens.filter((token) => token.kind === 'property').map((t) => t.text)).toEqual([
      '"tool"',
      '"n"',
    ]);
    expect(tokens.filter((token) => token.kind === 'number').map((t) => t.text)).toEqual(['2']);
    // A quoted string that is not JSON stays one string.
    expect(kindsOf(`echo 'hello world'`, 'bash', 'string')).toEqual([`'hello world'`]);
  });

  it('does not mistake a hash inside a word for a comment', () => {
    expect(kindsOf('echo a#b', 'bash', 'comment')).toEqual([]);
    expect(kindsOf('echo a #b', 'bash', 'comment')).toEqual(['#b']);
  });

  it('tells keywords, calls, properties and strings apart in JavaScript', () => {
    const code = 'const r = await api.get("x", 1); // go';
    expect(kindsOf(code, 'javascript', 'keyword')).toEqual(['const', 'await']);
    expect(kindsOf(code, 'javascript', 'function')).toEqual(['get']);
    expect(kindsOf('a.status', 'javascript', 'property')).toEqual(['status']);
    expect(kindsOf(code, 'javascript', 'string')).toEqual(['"x"']);
    expect(kindsOf(code, 'javascript', 'comment')).toEqual(['// go']);
    // `iffy(` is a call, not the keyword `if`.
    expect(kindsOf('iffy(1)', 'javascript', 'keyword')).toEqual([]);
    expect(kindsOf('iffy(1)', 'javascript', 'function')).toEqual(['iffy']);
  });

  it('handles template literals and f-strings as strings', () => {
    expect(kindsOf('`a ${b} c`', 'javascript', 'string')).toEqual(['`a ${b} c`']);
    expect(kindsOf('f"{a} b"', 'python', 'string')).toEqual(['f"{a} b"']);
    // A string over several lines is coloured line by line.
    expect(kindsOf('"""x\ny"""', 'python', 'string')).toEqual(['"""x', 'y"""']);
  });

  it('colours Python keywords and constants', () => {
    expect(kindsOf('if x is None: return True', 'python', 'keyword')).toEqual([
      'if',
      'is',
      'None',
      'return',
      'True',
    ]);
  });

  it('copes with text it does not understand', () => {
    expect(textOf(highlight('©±§ العربية ???', 'javascript'))).toBe('©±§ العربية ???');
    expect(highlight('', 'json')).toEqual([[]]);
  });
});
