import { describe, expect, it } from 'vitest';
import { negativePromptCategory } from '@/server/moderation/negative';

const check = (negativePrompt: string, prompt?: string, hasInputImage?: boolean) =>
  negativePromptCategory(negativePrompt, { prompt, hasInputImage });

describe('negativePromptCategory', () => {
  it('flags a list of garments excluded from a portrait of a person', () => {
    for (const negative of [
      'clothes, clothing, dressed, bikini, swimsuit, underwear',
      'clothes, clothing',
      'bra, panties, lingerie',
      'censored, mosaic',
      'Clothes; CLOTHING',
      'cl0thes, cl0thing',
      'ملابس، ثياب',
    ]) {
      expect(check(negative, 'portrait of a woman on a beach'), negative).toBe('sexual_explicit');
    }
  });

  it('flags it for prompts in Arabic and for family roles too', () => {
    expect(check('clothes, clothing', 'صورة امرأة على الشاطئ')).toBe('sexual_explicit');
    expect(check('clothes, clothing', 'a daughter at the beach')).toBe('sexual_explicit');
    expect(check('clothes, clothing', 'her portrait')).toBe('sexual_explicit');
  });

  it('lets one mention through, however it is worded', () => {
    for (const negative of [
      'wrinkled clothes',
      'ugly clothing',
      'bikini',
      'bikini, bikinis',
      'clothing, clothed',
      'ملابس',
    ]) {
      expect(check(negative, 'portrait of a woman on a beach'), negative).toBeNull();
    }
  });

  it('never flags the usual quality and safety negative prompts', () => {
    for (const negative of [
      'nsfw, nude, naked, topless, nipples, lowres, bad anatomy',
      'child, children, kid, loli, shota, underage, teen',
      'text, watermark, signature, extra fingers, blurry',
      'hate, racism, violence, gore, blood',
      '',
      '   ',
    ]) {
      expect(check(negative, 'portrait of a woman on a beach'), negative).toBeNull();
    }
  });

  it('only matters when the request can be about a person', () => {
    expect(check('clothes, clothing', 'a red fox in the snow')).toBeNull();
    expect(check('clothes, clothing', 'a castle on a hill, 4k')).toBeNull();
  });

  it('assumes a person when the prompt is unknown or a photo is being edited', () => {
    expect(check('clothes, clothing')).toBe('sexual_explicit');
    expect(check('clothes, clothing', 'a red fox in the snow', true)).toBe('sexual_explicit');
    expect(check('wrinkled clothes', undefined, true)).toBeNull();
  });

  it('does not take a part of a longer word for a garment', () => {
    expect(check('clothespin, clothesline', 'a woman hanging laundry')).toBeNull();
    expect(check('bracelet, brass', 'a woman at a market')).toBeNull();
  });
});
