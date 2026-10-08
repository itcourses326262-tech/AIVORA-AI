import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss, { type AtRule, type Root, type Rule } from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';
import { contrast, luminance, over, parseColor } from './contrast';

const GLOBALS = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url));
const source = readFileSync(GLOBALS, 'utf8');

type Tokens = Record<string, string>;

/** `--name: value;` declarations of the rule whose selector is exactly `selector`. */
function tokensOf(root: Root, selector: string, media?: string): Tokens {
  const tokens: Tokens = {};
  root.walkRules((rule: Rule) => {
    if (rule.selector.replace(/\s+/g, ' ').trim() !== selector) return;
    const parent = rule.parent;
    const inMedia = parent?.type === 'atrule' && (parent as AtRule).name === 'media';
    if (media === undefined ? inMedia : !(inMedia && (parent as AtRule).params === media)) return;
    rule.walkDecls(/^--/, (decl) => {
      tokens[decl.prop] = decl.value.trim();
    });
  });
  return tokens;
}

let dark: Tokens;
let light: Tokens;
let systemLight: Tokens;
let sourceRoot: Root;

beforeAll(() => {
  sourceRoot = postcss.parse(source);
  dark = tokensOf(sourceRoot, ":root, :root[data-theme='dark']");
  light = tokensOf(sourceRoot, ":root[data-theme='light']");
  systemLight = tokensOf(sourceRoot, ":root[data-theme='system']", '(prefers-color-scheme: light)');
});

const SURFACES = ['--background', '--surface', '--surface-raised', '--surface-overlay'] as const;
const TEXT_TOKENS = [
  '--foreground',
  '--muted',
  '--subtle',
  '--brand',
  '--accent',
  '--success',
  '--warning',
  '--danger',
  '--info',
] as const;
const STATUS = ['success', 'warning', 'danger', 'info'] as const;

const themes = (): Array<[string, Tokens]> => [
  ['dark', dark],
  ['light', light],
];

describe('token sets', () => {
  it('dark and light define exactly the same tokens', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('keeps the original token names working (bg-background, text-foreground, text-muted, ring)', () => {
    for (const [, tokens] of themes()) {
      for (const name of ['--background', '--foreground', '--muted', '--ring'])
        expect(tokens).toHaveProperty(name);
    }
  });

  it('system under a light OS is identical to the light theme', () => {
    expect(systemLight).toEqual(light);
  });

  it('every token a theme defines is mapped to a Tailwind colour or is a documented depth token', () => {
    const mapped = new Set<string>();
    sourceRoot.walkAtRules('theme', (rule) => {
      rule.walkDecls(/^--(color|shadow)-/, (decl) => {
        const target = /^var\((--[a-z-]+)\)$/.exec(decl.value.trim());
        if (target) mapped.add(target[1]!);
      });
    });
    const unmapped = Object.keys(dark).filter((name) => !mapped.has(name));
    // Gradient stops and shadow parts are consumed through var() in utilities, not as colours.
    expect(unmapped.sort()).toEqual(
      ['--primary-gradient-from', '--primary-gradient-to', '--highlight'].sort(),
    );
  });
});

describe.each(['dark', 'light'] as const)('WCAG AA contrast, %s theme', (name) => {
  const tokens = () => (name === 'dark' ? dark : light);
  const color = (token: string) => parseColor(tokens()[token]!);

  it.each(TEXT_TOKENS.flatMap((text) => SURFACES.map((surface) => [text, surface] as const)))(
    '%s text is readable on %s (4.5:1)',
    (text, surface) => {
      expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(STATUS)(
    '%s text is readable on its own soft tint over every surface (4.5:1)',
    (status) => {
      for (const surface of SURFACES) {
        const tint = over(color(`--${status}-soft`), color(surface));
        expect(
          contrast(color(`--${status}`), tint),
          `${status} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('brand text is readable on its soft tint', () => {
    for (const surface of SURFACES) {
      const tint = over(color('--brand-soft'), color(surface));
      expect(contrast(color('--brand'), tint)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('white text on the primary fill and on both ends of the primary gradient (4.5:1)', () => {
    const white = parseColor(tokens()['--primary-foreground']!);
    for (const fill of [
      '--primary',
      '--primary-hover',
      '--primary-gradient-from',
      '--primary-gradient-to',
    ]) {
      expect(contrast(white, color(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on the solid danger button (4.5:1), at rest and hovered', () => {
    const text = color('--danger-solid-foreground');
    expect(contrast(text, color('--danger-solid'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, color('--danger-solid-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('form control outlines and the focus ring meet the 3:1 non-text contrast', () => {
    for (const surface of ['--background', '--surface'] as const) {
      expect(
        contrast(color('--field-border'), color(surface)),
        'field border',
      ).toBeGreaterThanOrEqual(3);
      expect(contrast(color('--ring'), color(surface)), 'focus ring').toBeGreaterThanOrEqual(3);
    }
  });

  it('the brand gradient stays visible as a large-type fill on the page background (3:1)', () => {
    for (const end of ['--brand-from', '--brand-to']) {
      expect(contrast(color(end), color('--background')), end).toBeGreaterThanOrEqual(3);
    }
  });

  it('surfaces step up from the page background', () => {
    const lum = (token: string) => luminance(color(token));
    if (name === 'dark') {
      expect(lum('--background')).toBeLessThan(lum('--surface'));
      expect(lum('--surface')).toBeLessThan(lum('--surface-raised'));
      expect(lum('--surface-raised')).toBeLessThan(lum('--surface-overlay'));
    } else {
      // Light surfaces are white cards on a tinted page.
      expect(lum('--background')).toBeLessThan(lum('--surface'));
    }
  });
});

describe('direction and motion', () => {
  it('defines --flow as +1 in LTR and -1 in RTL, and mirrors the brand gradient angle', () => {
    expect(tokensOf(sourceRoot, ':root')['--flow']).toBe('1');
    const rtl = tokensOf(sourceRoot, ":root[dir='rtl']");
    expect(rtl['--flow']).toBe('-1');
    expect(rtl['--brand-angle']).toBe('240deg');
    expect(tokensOf(sourceRoot, ':root')['--brand-angle']).toBe('120deg');
  });

  it('collapses every animation and transition under prefers-reduced-motion', () => {
    const durations: string[] = [];
    sourceRoot.walkAtRules('media', (rule) => {
      if (rule.params !== '(prefers-reduced-motion: reduce)') return;
      rule.walkRules((inner) => {
        if (inner.selector.replace(/\s+/g, '') !== '*,::before,::after') return;
        inner.walkDecls(/^(animation|transition)-duration$/, (decl) => {
          durations.push(`${decl.value}${decl.important ? ' !important' : ''}`);
        });
      });
    });
    expect(durations).toEqual(['0.01ms !important', '0.01ms !important']);
  });

  it('never letter-spaces Arabic, which would tear its joined letters apart', () => {
    let found = false;
    sourceRoot.walkRules((rule) => {
      if (rule.selector.includes("[lang='ar'] *")) {
        rule.walkDecls('letter-spacing', (decl) => {
          found = decl.value.includes('normal');
        });
      }
    });
    expect(found).toBe(true);
  });
});

describe('compiled utilities', () => {
  let css: string;

  beforeAll(async () => {
    const probes = [
      'text-gradient-brand',
      'bg-brand-gradient',
      'bg-primary-gradient',
      'border-gradient-brand',
      'glow-brand',
      'surface-glass',
      'bg-aurora',
      'bg-dots',
      'no-scrollbar',
      'bg-shimmer',
      'bg-surface',
      'bg-surface-raised',
      'bg-surface-overlay',
      'text-subtle',
      'text-brand',
      'border-field',
      'bg-success-soft',
      'text-danger',
      'bg-danger-solid',
      'shadow-glow',
      'shadow-md',
      'rounded-xl',
      'bg-primary/20',
      'animate-fade-in',
      'animate-slide-in-start',
      'animate-shimmer',
      'animate-spinner',
      'animate-pulse-soft',
      'animate-toast-in',
      'animate-indeterminate',
    ].join(' ');
    // `optimize` is what `next build` does (lightningcss: prefixes, flattening), so assert on that.
    const result = await postcss([tailwind({ optimize: { minify: false } })]).process(
      `${source}\n@source inline("${probes}");\n`,
      {
        from: GLOBALS,
      },
    );
    css = result.css;
  }, 60_000);

  it('emits the brand utilities', () => {
    for (const name of [
      'text-gradient-brand',
      'bg-brand-gradient',
      'bg-primary-gradient',
      'border-gradient-brand',
      'glow-brand',
      'surface-glass',
      'bg-aurora',
      'bg-dots',
      'no-scrollbar',
      'bg-shimmer',
    ]) {
      expect(css, name).toContain(`.${name}`);
    }
  });

  it('maps the surfaces, text and status tokens to utilities', () => {
    expect(css).toMatch(/\.bg-surface-overlay\s*{\s*background-color: var\(--surface-overlay\)/);
    expect(css).toMatch(/\.text-subtle\s*{\s*color: var\(--subtle\)/);
    expect(css).toMatch(/\.border-field\s*{\s*border-color: var\(--field-border\)/);
    expect(css).toMatch(/\.bg-danger-solid\s*{\s*background-color: var\(--danger-solid\)/);
  });

  it('keeps the unprefixed backdrop-filter on frosted surfaces (a prefix-only output breaks Chromium)', () => {
    const rule = /\.surface-glass\s*{[^}]*}/g;
    const blocks = css.match(rule) ?? [];
    expect(blocks.join('\n')).toMatch(/(?<!-webkit-)backdrop-filter:\s*blur\(16px\)/);
  });

  it('defines every animation it names, so none is a dangling reference', () => {
    const keyframes = new Set(
      Array.from(css.matchAll(/@keyframes ([\w-]+)/g), (match) => match[1]),
    );
    for (const name of [
      'fade-in',
      'slide-in-start',
      'shimmer',
      'spinner',
      'pulse-soft',
      'toast-in',
      'indeterminate',
    ]) {
      expect(keyframes.has(name), name).toBe(true);
    }
  });

  it('mirrors the sheet slide direction through --flow', () => {
    expect(css).toMatch(
      /@keyframes slide-in-start\s*{\s*from\s*{\s*transform: translateX\(calc\(var\(--flow\) \* -100%\)\)/,
    );
  });
});
