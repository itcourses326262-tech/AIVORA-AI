import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('the code window keeps its dark palette readable in both themes', () => {
  const teaser = read('../../../src/components/marketing/api-teaser.tsx');
  const copy = read('../../../src/components/marketing/copy-button.tsx');
  const background = /bg-\[(#[0-9a-f]{6})\]/i.exec(teaser)?.[1] ?? '';

  it('finds the window background', () => {
    expect(background).toBe('#0d0d1c');
  });

  it('gives every token colour and label at least 4.5:1 on it', () => {
    const colours = [...(teaser + copy).matchAll(/text-\[(#[0-9a-f]{6})\]/gi)].map((m) => m[1]!);
    expect(new Set(colours).size).toBeGreaterThanOrEqual(8);
    for (const colour of new Set(colours)) {
      expect(contrast(colour, background), colour).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws focus outlines at least 3:1 against it', () => {
    const outlines = [...(teaser + copy).matchAll(/outline-\[(#[0-9a-f]{6})\]/gi)].map(
      (m) => m[1]!,
    );
    expect(outlines.length).toBeGreaterThan(0);
    for (const outline of new Set(outlines)) {
      expect(contrast(outline, background), outline).toBeGreaterThanOrEqual(3);
    }
  });
});
