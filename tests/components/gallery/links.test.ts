import { describe, expect, it } from 'vitest';
import { detailHref, inputHref, remixHref, reuseHref, sharePath } from '@/components/gallery/links';
import { parsePrefill } from '@/components/studio/prefill';
import { loginUrl, safeNextPath } from '@/lib/next-path';
import { assetDTO, generationDTO } from '../generations/support';

const toParams = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);

describe('addresses of the gallery', () => {
  it('builds the detail and the public path from an id', () => {
    expect(detailHref('gen_1')).toBe('/gallery/gen_1');
    expect(sharePath('gen_1')).toBe('/s/gen_1');
  });
});

describe('reuseHref (Reuse settings)', () => {
  it('opens the studio on the same tool, model and prompt', () => {
    const href = reuseHref(
      generationDTO({ tool: 'text-to-image', modelId: 'aivore-demo-image', prompt: 'a cat' }),
    );
    expect(parsePrefill(toParams(href))).toEqual({
      tool: 'text-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'a cat',
    });
  });

  it('keeps the input picture of an image tool, because it is the owner’s own', () => {
    const input = assetDTO({ id: 'ast_01hzzzzzzzzzzzzzzzzzzzzzzz' });
    const href = reuseHref(generationDTO({ tool: 'image-to-image', input }));
    expect(parsePrefill(toParams(href))).toMatchObject({
      tool: 'image-to-image',
      inputAssetId: input.id,
    });
  });

  it('does not send an input along with a text tool', () => {
    const href = reuseHref(
      generationDTO({
        tool: 'text-to-video',
        input: assetDTO({ id: 'ast_01hzzzzzzzzzzzzzzzzzzzzzzz' }),
      }),
    );
    expect(toParams(href).input).toBeUndefined();
  });

  it('survives a prompt with Arabic text and special characters', () => {
    const prompt = 'غابة & "ضباب" #1 <b>';
    expect(parsePrefill(toParams(reuseHref(generationDTO({ prompt })))).prompt).toBe(prompt);
  });
});

describe('inputHref (Edit / Animate this image)', () => {
  it('starts the image tool from the asset', () => {
    const id = 'ast_01hzzzzzzzzzzzzzzzzzzzzzzz';
    expect(parsePrefill(toParams(inputHref('image-to-video', id)))).toEqual({
      tool: 'image-to-video',
      inputAssetId: id,
    });
    expect(parsePrefill(toParams(inputHref('image-to-image', id)))).toMatchObject({
      tool: 'image-to-image',
    });
  });
});

describe('remixHref (Remix in Studio)', () => {
  it('uses the text tool of the same kind and keeps the model when that tool offers it', () => {
    expect(
      parsePrefill(
        toParams(remixHref({ kind: 'image', modelId: 'aivore-demo-image', prompt: 'a cat' })),
      ),
    ).toEqual({ tool: 'text-to-image', modelId: 'aivore-demo-image', prompt: 'a cat' });
    expect(
      parsePrefill(
        toParams(remixHref({ kind: 'video', modelId: 'aivore-demo-video', prompt: 'waves' })),
      ),
    ).toEqual({ tool: 'text-to-video', modelId: 'aivore-demo-video', prompt: 'waves' });
  });

  it('drops a model that no longer exists instead of sending the studio a broken id', () => {
    const params = toParams(remixHref({ kind: 'image', modelId: 'retired-model', prompt: 'x' }));
    expect(params.model).toBeUndefined();
    expect(params.tool).toBe('text-to-image');
  });

  it('never carries an input picture: a public page does not share it', () => {
    expect(
      toParams(remixHref({ kind: 'image', modelId: 'aivore-demo-image', prompt: 'x' })).input,
    ).toBeUndefined();
  });

  it('cuts a very long prompt so the login redirect keeps the whole remix address', () => {
    const prompt = 'غابة سحرية '.repeat(400);
    const href = remixHref({ kind: 'image', modelId: 'aivore-demo-image', prompt });
    // A visitor goes through /login?next=<href>; a next longer than 2048 would be thrown away.
    expect(safeNextPath(href, '')).toBe(href);
    expect(loginUrl(href)).toContain('next=');
    const cut = parsePrefill(toParams(href)).prompt ?? '';
    expect(cut.length).toBeGreaterThan(100);
    expect(prompt.startsWith(cut)).toBe(true);
  });

  it('leaves a normal prompt whole', () => {
    const prompt = 'A lone lighthouse at sunset, ultra detailed, 35mm';
    expect(
      parsePrefill(toParams(remixHref({ kind: 'image', modelId: 'aivore-demo-image', prompt })))
        .prompt,
    ).toBe(prompt);
  });
});
