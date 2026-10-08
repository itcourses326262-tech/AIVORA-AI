import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ASPECT_RATIOS } from '@/lib/catalog/types';
import { falModels } from '@/lib/catalog/models/fal';
import { getFalAdapter } from '@/server/providers/fal/adapters';
import { FLUX_SIZES, SAFETY_TOLERANCE } from '@/server/providers/fal/adapters/shared';
import { ProviderError } from '@/server/providers/errors';
import { FAL_INPUT_SCHEMAS } from './fal-input-schemas';
import { inputFor, pngImage, type InputOptions } from './fixtures';

async function bodyOf(modelId: string, options: InputOptions = {}) {
  const input = inputFor(modelId, options);
  return getFalAdapter(input.model.providerModel).buildInput(input);
}

async function withImage(modelId: string, options: InputOptions = {}) {
  const bytes = await pngImage(640, 480);
  return bodyOf(modelId, {
    ...options,
    inputImage: { bytes, mimeType: 'image/png', width: 640, height: 480 },
  });
}

function dataUriOf(value: unknown): { mimeType: string; bytes: Buffer } {
  expect(typeof value).toBe('string');
  const match = /^data:([^;]+);base64,(.+)$/.exec(value as string);
  expect(match).not.toBeNull();
  return { mimeType: match?.[1] as string, bytes: Buffer.from(match?.[2] as string, 'base64') };
}

describe('FLUX size table', () => {
  it('has an entry per aspect ratio, under 1 MP, in multiples of 16 and true to the ratio', () => {
    expect(Object.keys(FLUX_SIZES).sort()).toEqual([...ASPECT_RATIOS].sort());
    for (const ratio of ASPECT_RATIOS) {
      const { width, height } = FLUX_SIZES[ratio];
      const [w, h] = ratio.split(':').map(Number) as [number, number];
      expect(width * height).toBeLessThanOrEqual(1_000_000);
      expect(width * height).toBeGreaterThan(500_000);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
      expect(Math.abs(width / height / (w / h) - 1)).toBeLessThan(0.01);
    }
  });
});

describe('text-to-image request bodies', () => {
  it('FLUX.1 schnell sends the size, count and safety checker, and no negative prompt', async () => {
    const body = await bodyOf('fal-flux-schnell', {
      prompt: 'a lighthouse',
      negativePrompt: 'blurry',
      params: { aspectRatio: '16:9', count: 3 },
    });
    expect(body).toEqual({
      prompt: 'a lighthouse',
      image_size: { width: 1280, height: 720 },
      num_images: 3,
      enable_safety_checker: true,
    });
  });

  it('sends the seed only when one is given, and zero is a seed', async () => {
    expect(await bodyOf('fal-flux-schnell', { params: { seed: 0 } })).toHaveProperty('seed', 0);
    expect(await bodyOf('fal-flux-schnell', { params: { seed: 424242 } })).toHaveProperty(
      'seed',
      424242,
    );
    expect(await bodyOf('fal-flux-schnell')).not.toHaveProperty('seed');
  });

  it('never sends strength to a text-to-image model', async () => {
    expect(await bodyOf('fal-flux-schnell', { params: { strength: 0.5 } })).not.toHaveProperty(
      'strength',
    );
  });

  it('FLUX.2 pro asks for one image and has no num_images field', async () => {
    const body = await bodyOf('fal-flux-2-pro', { params: { aspectRatio: '21:9', seed: 7 } });
    expect(body).toEqual({
      prompt: 'a red fox in the snow',
      image_size: { width: 1344, height: 576 },
      safety_tolerance: '2',
      enable_safety_checker: true,
      seed: 7,
    });
  });

  it('Nano Banana Pro passes the aspect ratio through at 1K', async () => {
    const body = await bodyOf('fal-nano-banana-pro', {
      params: { aspectRatio: '21:9', count: 2 },
      negativePrompt: 'ignored',
    });
    expect(body).toEqual({
      prompt: 'a red fox in the snow',
      aspect_ratio: '21:9',
      resolution: '1K',
      num_images: 2,
      safety_tolerance: '2',
    });
  });

  it('every catalog ratio of the two image models is accepted by fal (documented enum)', async () => {
    const documented = new Set([
      'auto',
      '21:9',
      '16:9',
      '3:2',
      '4:3',
      '5:4',
      '1:1',
      '4:5',
      '3:4',
      '2:3',
      '9:16',
    ]);
    const nano = falModels.find((model) => model.id === 'fal-nano-banana-pro');
    for (const ratio of nano?.limits.aspectRatios ?? []) expect(documented.has(ratio)).toBe(true);
  });
});

describe('image-to-image request bodies', () => {
  it('Nano Banana Pro edit sends the image as a data URI in image_urls and keeps its shape', async () => {
    const body = await withImage('fal-nano-banana-pro-edit', {
      prompt: 'make it night',
      params: { aspectRatio: '9:16', count: 2, seed: 9 },
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'aspect_ratio',
        'image_urls',
        'num_images',
        'prompt',
        'resolution',
        'safety_tolerance',
        'seed',
      ].sort(),
    );
    expect(body.aspect_ratio).toBe('auto');
    expect(body.resolution).toBe('1K');
    expect(body.num_images).toBe(2);
    const urls = body.image_urls as unknown[];
    expect(urls).toHaveLength(1);
    const image = dataUriOf(urls[0]);
    expect(image.mimeType).toBe('image/png');
    expect((await sharp(image.bytes).metadata()).width).toBe(640);
  });

  it('FLUX.1 dev img2img sends the strength clamped, and omits it when unset', async () => {
    const withStrength = await withImage('fal-flux-dev-img2img', { params: { strength: 0.6 } });
    expect(withStrength.strength).toBe(0.6);
    expect((await withImage('fal-flux-dev-img2img', { params: { strength: 5 } })).strength).toBe(1);
    expect((await withImage('fal-flux-dev-img2img', { params: { strength: 0 } })).strength).toBe(
      0.01,
    );
    expect(await withImage('fal-flux-dev-img2img')).not.toHaveProperty('strength');
  });

  it('FLUX.1 dev img2img sends no size or aspect ratio and shrinks the input under 1 MP', async () => {
    const bytes = await pngImage(2400, 1600);
    const body = await bodyOf('fal-flux-dev-img2img', {
      inputImage: { bytes, mimeType: 'image/png' },
      params: { aspectRatio: '9:16', count: 2 },
    });
    expect(body).not.toHaveProperty('image_size');
    expect(body).not.toHaveProperty('aspect_ratio');
    expect(body.num_images).toBe(2);
    const meta = await sharp(dataUriOf(body.image_url).bytes).metadata();
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(1_000_000);
    expect((meta.width ?? 0) % 16).toBe(0);
    expect((meta.height ?? 0) % 16).toBe(0);
  });

  it('refuses a request without the input image the tool needs', async () => {
    const error = await bodyOf('fal-flux-dev-img2img').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('invalid_input');
    expect((error as ProviderError).retryable).toBe(false);
  });
});

describe('video request bodies', () => {
  it('Wan 2.6 text-to-video sends duration as a string, the ratio and a capped negative prompt', async () => {
    const body = await bodyOf('fal-wan-2-6-t2v', {
      prompt: 'waves',
      negativePrompt: `  ${'x'.repeat(600)}  `,
      params: { aspectRatio: '9:16', durationSec: 10, resolution: '1080p', seed: 3 },
    });
    expect(body).toEqual({
      prompt: 'waves',
      aspect_ratio: '9:16',
      resolution: '1080p',
      duration: '10',
      multi_shots: false,
      negative_prompt: 'x'.repeat(500),
      seed: 3,
    });
  });

  it('Wan 2.6 text-to-video falls back to the model defaults and skips a blank negative prompt', async () => {
    const body = await bodyOf('fal-wan-2-6-t2v', { negativePrompt: '   ' });
    expect(body).toEqual({
      prompt: 'a red fox in the snow',
      aspect_ratio: '16:9',
      resolution: '720p',
      duration: '5',
      multi_shots: false,
    });
  });

  it('Wan 2.6 image-to-video flattens transparency, enlarges tiny images and sends no ratio', async () => {
    const bytes = await pngImage(200, 100, { alpha: true });
    const body = await bodyOf('fal-wan-2-6-i2v', {
      inputImage: { bytes, mimeType: 'image/png' },
      params: { aspectRatio: '1:1' },
    });
    expect(body).not.toHaveProperty('aspect_ratio');
    expect(body).toMatchObject({ resolution: '720p', duration: '5' });
    const image = dataUriOf(body.image_url);
    expect(image.mimeType).toBe('image/jpeg');
    const meta = await sharp(image.bytes).metadata();
    expect(meta.hasAlpha).toBe(false);
    expect(Math.min(meta.width ?? 0, meta.height ?? 0)).toBeGreaterThanOrEqual(240);
  });

  it('Veo 3.1 Fast text-to-video asks for audio and formats the duration as "<n>s"', async () => {
    const body = await bodyOf('fal-veo-3-1-fast', {
      prompt: 'a street at dusk',
      negativePrompt: 'cartoon',
      params: { aspectRatio: '9:16', durationSec: 8, seed: 11 },
    });
    expect(body).toEqual({
      prompt: 'a street at dusk',
      aspect_ratio: '9:16',
      duration: '8s',
      resolution: '720p',
      generate_audio: true,
      auto_fix: false,
      safety_tolerance: '2',
      negative_prompt: 'cartoon',
      seed: 11,
    });
  });

  it('Veo 3.1 Fast image-to-video sends the ratio, "<n>s", audio and the negative prompt', async () => {
    const body = await withImage('fal-veo-3-1-fast-i2v', {
      negativePrompt: 'cartoon',
      params: { durationSec: 6 },
    });
    expect(body).toMatchObject({
      negative_prompt: 'cartoon',
      aspect_ratio: '16:9',
      duration: '6s',
      resolution: '720p',
      generate_audio: true,
      auto_fix: false,
      safety_tolerance: '2',
    });
    expect(dataUriOf(body.image_url).mimeType).toBe('image/png');
  });
});

describe('content moderation settings', () => {
  const MODELS_WITH_TOLERANCE = falModels.filter(
    (model) => FAL_INPUT_SCHEMAS[model.providerModel]?.fields.safety_tolerance !== undefined,
  );

  it('covers every model whose input takes safety_tolerance', () => {
    expect(MODELS_WITH_TOLERANCE.map((model) => model.id).sort()).toEqual([
      'fal-flux-2-pro',
      'fal-nano-banana-pro',
      'fal-nano-banana-pro-edit',
      'fal-veo-3-1-fast',
      'fal-veo-3-1-fast-i2v',
    ]);
  });

  it.each(MODELS_WITH_TOLERANCE.map((model) => [model.id, model] as const))(
    '%s pins the strict tolerance instead of inheriting its own lenient default',
    async (id, model) => {
      const needsImage = model.tools.some((tool) => tool.startsWith('image-to-'));
      const body = needsImage ? await withImage(id) : await bodyOf(id);
      expect(body.safety_tolerance).toBe(SAFETY_TOLERANCE);
      expect(SAFETY_TOLERANCE).toBe('2');
    },
  );

  it.each(['fal-veo-3-1-fast', 'fal-veo-3-1-fast-i2v'])(
    '%s never lets fal rewrite a prompt that fails its content rules',
    async (id) => {
      const body = id.endsWith('-i2v') ? await withImage(id) : await bodyOf(id);
      expect(body.auto_fix).toBe(false);
    },
  );

  it('does not send moderation fields to models that have none', async () => {
    for (const id of ['fal-wan-2-6-t2v', 'fal-flux-schnell']) {
      const body = await bodyOf(id);
      expect(body).not.toHaveProperty('safety_tolerance');
      expect(body).not.toHaveProperty('auto_fix');
    }
  });
});

describe('getFalAdapter', () => {
  it('rejects an endpoint it has no adapter for, including inherited property names', () => {
    for (const endpoint of ['fal-ai/unknown', 'constructor', '__proto__', 'toString']) {
      expect(() => getFalAdapter(endpoint)).toThrow(ProviderError);
    }
  });
});
