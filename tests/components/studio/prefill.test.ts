import { describe, expect, it } from 'vitest';
import { newId } from '@/lib/id';
import { isEmptyPrefill, parsePrefill, prefillKey, studioHref } from '@/components/studio/prefill';

const ast = newId('ast');

describe('parsePrefill', () => {
  it('reads tool, model, prompt and input', () => {
    expect(
      parsePrefill({
        tool: 'image-to-video',
        model: 'aivore-demo-video',
        prompt: ' Slow zoom ',
        input: ast,
      }),
    ).toEqual({
      tool: 'image-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'Slow zoom',
      inputAssetId: ast,
    });
  });

  it('is empty for a plain /studio', () => {
    const prefill = parsePrefill({});
    expect(prefill).toEqual({});
    expect(isEmptyPrefill(prefill)).toBe(true);
    expect(prefillKey(prefill)).toBe('');
  });

  it('drops a tool that does not exist, and an input that is not an asset id', () => {
    expect(
      parsePrefill({ tool: 'text-to-sound', input: 'gen_01m4ekkphefnxf2wwdn6nxrhm7' }),
    ).toEqual({});
    expect(parsePrefill({ input: '../../etc/passwd' })).toEqual({});
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parsePrefill({ tool: ['text-to-video', 'text-to-image'] }).tool).toBe('text-to-video');
  });

  it('infers the tool: a model alone implies one it serves, an input alone implies editing it', () => {
    expect(parsePrefill({ model: 'aivore-demo-video' }).tool).toBe('text-to-video');
    expect(parsePrefill({ model: 'aivore-demo-image' }).tool).toBe('text-to-image');
    expect(parsePrefill({ model: 'unknown-model' }).tool).toBeUndefined();
    expect(parsePrefill({ input: ast }).tool).toBe('image-to-image');
  });

  it('ignores an input for a tool that takes none', () => {
    expect(parsePrefill({ tool: 'text-to-image', input: ast })).toEqual({ tool: 'text-to-image' });
    expect(parsePrefill({ tool: 'image-to-video', input: ast }).inputAssetId).toBe(ast);
  });

  it('bounds what a URL can push in', () => {
    expect(parsePrefill({ prompt: 'x'.repeat(10_000) }).prompt).toHaveLength(4000);
    expect(parsePrefill({ model: 'm'.repeat(101) }).modelId).toBeUndefined();
    expect(parsePrefill({ prompt: '   ' })).toEqual({});
  });
});

describe('studioHref and prefillKey', () => {
  it('builds the link another page uses, and parses back to the same thing', () => {
    const prefill = {
      tool: 'image-to-video' as const,
      inputAssetId: ast,
      prompt: 'Slow zoom & pan',
    };
    const href = studioHref(prefill);
    expect(href.startsWith('/studio?')).toBe(true);
    const query = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(parsePrefill(query)).toEqual(prefill);
  });

  it('is just /studio without anything', () => {
    expect(studioHref()).toBe('/studio');
    expect(studioHref({})).toBe('/studio');
  });

  it('tells the same request from a different one', () => {
    expect(prefillKey({ tool: 'text-to-image' })).toBe(prefillKey({ tool: 'text-to-image' }));
    expect(prefillKey({ tool: 'text-to-image' })).not.toBe(prefillKey({ tool: 'text-to-video' }));
  });
});
