import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShowcaseArt } from '@/components/marketing/showcase-art';
import { SHOWCASE_ITEMS } from '@/components/marketing/showcase-data';

const render = (index: number, uid = 'a') => {
  const item = SHOWCASE_ITEMS[index]!;
  return renderToStaticMarkup(
    <ShowcaseArt art={item.art} size={item.size} palette={item.palette} uid={uid} />,
  );
};

describe('showcase artwork', () => {
  it('draws every sample as a decorative SVG that scales to cover its card', () => {
    SHOWCASE_ITEMS.forEach((_, index) => {
      const svg = render(index);
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
      expect(svg).not.toContain('NaN');
    });
  });

  it('is deterministic: the same sample renders the same markup (no Math.random)', () => {
    SHOWCASE_ITEMS.forEach((_, index) => expect(render(index)).toBe(render(index)));
  });

  it('prefixes gradient ids with the uid so two cards never share one', () => {
    const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    SHOWCASE_ITEMS.forEach((_, index) => {
      const first = ids(render(index, 'one'));
      const second = ids(render(index, 'two'));
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((id) => id?.startsWith('one-'))).toBe(true);
      expect(first.filter((id) => second.includes(id))).toEqual([]);
    });
  });

  it('only moves the artwork of video samples', () => {
    const item = SHOWCASE_ITEMS[1]!;
    const still = renderToStaticMarkup(
      <ShowcaseArt art={item.art} size={item.size} palette={item.palette} uid="x" />,
    );
    const moving = renderToStaticMarkup(
      <ShowcaseArt art={item.art} size={item.size} palette={item.palette} uid="x" moving />,
    );
    expect(still).toContain('<g>');
    expect(moving).toContain('<g class=');
  });
});

describe('showcase data', () => {
  it('is a mosaic of seven samples with unique ids, at least three of them video', () => {
    expect(SHOWCASE_ITEMS).toHaveLength(7);
    expect(new Set(SHOWCASE_ITEMS.map((item) => item.id)).size).toBe(7);
    const videos = SHOWCASE_ITEMS.filter((item) => item.kind === 'video');
    expect(videos.length).toBeGreaterThanOrEqual(3);
    expect(videos.every((item) => item.seconds !== undefined)).toBe(true);
  });

  it('fills a four-column grid exactly: 2x2, 1x2 and four singles plus one 2x1 make 12 cells', () => {
    const cells = { hero: 4, tall: 2, wide: 2, square: 1 };
    const total = SHOWCASE_ITEMS.reduce((sum, item) => sum + cells[item.size], 0);
    expect(total).toBe(12);
  });
});
