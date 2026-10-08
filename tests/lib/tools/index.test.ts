import * as icons from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '@/lib/catalog/types';
import { createTranslator, type MessageKey } from '@/lib/i18n';
import { getTool, getTools } from '@/lib/tools';

describe('tools registry', () => {
  it('declares exactly the four tools of the product', () => {
    expect(getTools().map((tool) => tool.id)).toEqual([...TOOLS]);
  });

  it('matches the table in ARCHITECTURE.md', () => {
    expect(
      getTools().map(({ id, kind, needsInputImage }) => ({ id, kind, needsInputImage })),
    ).toEqual([
      { id: 'text-to-image', kind: 'image', needsInputImage: false },
      { id: 'image-to-image', kind: 'image', needsInputImage: true },
      { id: 'text-to-video', kind: 'video', needsInputImage: false },
      { id: 'image-to-video', kind: 'video', needsInputImage: true },
    ]);
  });

  it('looks tools up by id', () => {
    expect(getTool('image-to-video')).toMatchObject({ kind: 'video', needsInputImage: true });
    expect(getTool('nope' as never)).toBeUndefined();
  });

  it('hands out copies so callers cannot alter the registry', () => {
    const tool = getTool('text-to-image');
    if (!tool) throw new Error('missing tool');
    tool.needsInputImage = true;
    expect(getTool('text-to-image')?.needsInputImage).toBe(false);
    getTools().pop();
    expect(getTools()).toHaveLength(4);
  });

  it('names an existing lucide icon for each tool', () => {
    const exports = icons as Record<string, unknown>;
    for (const tool of getTools()) {
      const componentName = tool.icon
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
      expect(exports[componentName], `${tool.icon} -> ${componentName}`).toBeDefined();
    }
  });

  it('has a translated name and description for every tool in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      const { t } = createTranslator(locale);
      for (const tool of getTools()) {
        for (const part of ['name', 'description'] as const) {
          const key = `${tool.i18nKey}.${part}` as MessageKey;
          expect(t(key), `${locale} ${key}`).not.toBe(key);
        }
      }
    }
  });
});
