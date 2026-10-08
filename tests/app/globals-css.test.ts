import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss, {
  type AtRule,
  type Container,
  type Declaration,
  type Document,
  type Root,
  type Rule,
} from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

const GLOBALS = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url));

let root: Root;

beforeAll(async () => {
  // Compile the real stylesheet with the project's Tailwind plugin; the probe classes force the
  // utilities under test into the output.
  const source = `${readFileSync(GLOBALS, 'utf8')}\n@source inline("dark:bg-black font-sans");\n`;
  const result = await postcss([tailwind()]).process(source, { from: GLOBALS });
  root = result.root;
}, 60_000);

function enclosingMedia(rule: Rule): string | undefined {
  for (let node: Container | Document | undefined = rule.parent; node; node = node.parent) {
    if (node.type === 'atrule' && (node as AtRule).name === 'media') return (node as AtRule).params;
  }
  return undefined;
}

function rulesMatching(pattern: RegExp): Array<{ rule: Rule; media: string | undefined }> {
  const found: Array<{ rule: Rule; media: string | undefined }> = [];
  root.walkRules((rule) => {
    if (pattern.test(rule.selector)) found.push({ rule, media: enclosingMedia(rule) });
  });
  return found;
}

function declarationOf(rule: Rule, prop: string): string | undefined {
  let value: string | undefined;
  rule.walkDecls(prop, (decl: Declaration) => {
    value = decl.value;
  });
  return value;
}

describe('dark: variant', () => {
  const darkRules = () => rulesMatching(/dark\\:bg-black/);

  it('is driven by data-theme, never by the OS preference alone', () => {
    const rules = darkRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const { rule, media } of rules) {
      expect(rule.selector, rule.selector).toMatch(/\[data-theme=['"](?:dark|system)['"]\]/);
      if (media === undefined) expect(rule.selector).toContain("[data-theme='dark']");
    }
  });

  it('applies unconditionally in the explicit dark theme', () => {
    const explicit = darkRules().filter(({ rule }) => rule.selector.includes("data-theme='dark'"));
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.media).toBeUndefined();
  });

  it('follows the OS only in the system theme', () => {
    const system = darkRules().filter(({ rule }) => rule.selector.includes("data-theme='system'"));
    expect(system).toHaveLength(1);
    expect(system[0]?.media).toBe('(prefers-color-scheme: dark)');
  });

  it('never applies in the light theme, whatever the OS prefers', () => {
    for (const { rule } of darkRules()) expect(rule.selector).not.toContain('light');
    expect(
      darkRules().some(({ rule, media }) => media && !rule.selector.includes('data-theme')),
    ).toBe(false);
  });
});

describe('font stacks', () => {
  const stackOf = (selectorPattern: RegExp): string | undefined => {
    const rule = rulesMatching(selectorPattern).find(
      ({ rule: candidate }) => declarationOf(candidate, '--font-family-base') !== undefined,
    )?.rule;
    return rule && declarationOf(rule, '--font-family-base');
  };

  it('puts Inter first by default and Cairo first on Arabic pages', () => {
    expect(stackOf(/^:root$/)).toMatch(/^'Inter Variable', 'Cairo Variable'/);
    expect(stackOf(/^:root\[lang=['"]ar['"]\]$/)).toMatch(/^'Cairo Variable', 'Inter Variable'/);
  });

  it('makes the font-sans utility and the page default follow the language', () => {
    const utility = rulesMatching(/^\.font-sans$/);
    expect(utility).toHaveLength(1);
    expect(utility[0] && declarationOf(utility[0].rule, 'font-family')).toBe(
      'var(--font-family-base)',
    );
    // Tailwind's preflight sets `html { font-family: var(--default-font-family) }`.
    const defaults = rulesMatching(/^:root/).map(({ rule }) =>
      declarationOf(rule, '--default-font-family'),
    );
    expect(defaults).toContain('var(--font-family-base)');
  });

  it('has no rule that pins a literal Inter-first stack over the language-aware one', () => {
    const literal: string[] = [];
    root.walkDecls('font-family', (decl) => {
      // `@font-face` blocks legitimately name the family they define.
      const inFontFace =
        decl.parent?.type === 'atrule' && (decl.parent as AtRule).name === 'font-face';
      if (!inFontFace && /^'?Inter Variable/.test(decl.value)) literal.push(decl.value);
    });
    expect(literal).toEqual([]);
  });
});
