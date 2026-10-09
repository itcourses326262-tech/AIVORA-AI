import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  previewImage,
  shareJsonLd,
  shareMetadata,
} from '@/components/gallery/share-meta';
import { toPublicCreation } from '@/components/gallery/public-creation';
import { createTranslator } from '@/lib/i18n';
import { assetDTO, generationDTO } from '../generations/support';

const ORIGIN = 'https://aivore.example';
const en = createTranslator('en');
const ar = createTranslator('ar');

const IMAGE = toPublicCreation(
  generationDTO({
    id: 'gen_01hzzzzzzzzzzzzzzzzzzzzzzz',
    prompt: 'A lone lighthouse at sunset',
    owner: { name: 'Layla Hassan' },
    outputs: [assetDTO({ id: 'ast_img', width: 1280, height: 720, mimeType: 'image/webp' })],
  }),
);

const CLIP = (extra = {}) =>
  toPublicCreation(
    generationDTO({
      kind: 'video',
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      owner: { name: 'Omar Khalid' },
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '480p' },
      outputs: [
        assetDTO({
          id: 'ast_vid',
          kind: 'video',
          mimeType: 'video/mp4',
          durationMs: 5000,
          ...extra,
        }),
      ],
    }),
  );

describe('absoluteUrl', () => {
  it('turns a path of the media route into an address on this deployment', () => {
    expect(absoluteUrl(ORIGIN, '/api/v1/media/ast_1')).toBe(`${ORIGIN}/api/v1/media/ast_1`);
    expect(absoluteUrl('http://localhost:3000', '/s/gen_1?x=1')).toBe(
      'http://localhost:3000/s/gen_1?x=1',
    );
  });
});

describe('previewImage', () => {
  it('uses the picture itself, with its size, for an image', () => {
    expect(previewImage(IMAGE, ORIGIN)).toEqual({
      url: `${ORIGIN}/api/v1/media/ast_img`,
      width: 1280,
      height: 720,
      type: 'image/webp',
    });
  });

  it('uses the still frame of a video', () => {
    expect(previewImage(CLIP(), ORIGIN)).toEqual({
      url: `${ORIGIN}/api/v1/media/ast_vid?variant=thumb`,
      type: 'image/webp',
    });
  });

  it('has none for a video file without a still frame, and uses an animated image itself', () => {
    expect(previewImage(CLIP({ thumbUrl: undefined }), ORIGIN)).toBeNull();
    expect(previewImage(CLIP({ thumbUrl: undefined, mimeType: 'image/gif' }), ORIGIN)).toEqual({
      url: `${ORIGIN}/api/v1/media/ast_vid`,
      type: 'image/gif',
    });
  });

  it('has none for a creation without results', () => {
    expect(previewImage({ ...IMAGE, outputs: [] }, ORIGIN)).toBeNull();
  });
});

describe('shareMetadata', () => {
  it('titles the page with the prompt and describes the model', () => {
    const metadata = shareMetadata(IMAGE, ORIGIN, en);
    expect(metadata.title).toBe('A lone lighthouse at sunset');
    expect(metadata.description).toBe(
      'Made with AIVORE Demo Image on AIVORE. Prompt: A lone lighthouse at sunset',
    );
    expect(metadata.alternates?.canonical).toBe('/s/gen_01hzzzzzzzzzzzzzzzzzzzzzzz');
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it('cuts a long prompt in the title and in the description', () => {
    const long = { ...IMAGE, prompt: 'word '.repeat(200).trim() };
    const metadata = shareMetadata(long, ORIGIN, en);
    expect(String(metadata.title).length).toBeLessThanOrEqual(71);
    expect(String(metadata.title).endsWith('…')).toBe(true);
    expect(String(metadata.description).length).toBeLessThan(260);
  });

  it('gives Open Graph an absolute address for the page and for the picture', () => {
    const og = shareMetadata(IMAGE, ORIGIN, en).openGraph;
    expect(og).toMatchObject({
      type: 'website',
      url: `${ORIGIN}/s/gen_01hzzzzzzzzzzzzzzzzzzzzzzz`,
      siteName: 'AIVORE',
      locale: 'en_US',
    });
    const images = og?.images;
    expect(images).toEqual([
      expect.objectContaining({
        url: `${ORIGIN}/api/v1/media/ast_img`,
        width: 1280,
        height: 720,
        type: 'image/webp',
        alt: expect.stringContaining('A lone lighthouse'),
      }),
    ]);
  });

  it('gives Twitter the large card with the same picture', () => {
    const twitter = shareMetadata(IMAGE, ORIGIN, en).twitter;
    expect(twitter).toMatchObject({ card: 'summary_large_image' });
    expect(JSON.stringify(twitter?.images)).toContain(`${ORIGIN}/api/v1/media/ast_img`);
  });

  it('falls back to the small card when there is no picture to show', () => {
    const metadata = shareMetadata(CLIP({ thumbUrl: undefined }), ORIGIN, en);
    expect(metadata.twitter).toMatchObject({ card: 'summary' });
    expect(metadata.openGraph).not.toHaveProperty('images');
  });

  it('speaks the active language', () => {
    const metadata = shareMetadata(IMAGE, ORIGIN, ar);
    expect(metadata.description).toContain('أُنشئ بنموذج');
    expect(metadata.openGraph).toMatchObject({ locale: 'ar_AR' });
  });

  it('never puts an email, the full name or a private field into the metadata', () => {
    const text = JSON.stringify(shareMetadata(IMAGE, ORIGIN, en));
    expect(text).not.toContain('Hassan');
    expect(text).not.toMatch(/@/);
  });
});

describe('shareJsonLd', () => {
  it('describes a picture as an ImageObject with absolute addresses and the first name of the creator', () => {
    const data = shareJsonLd(IMAGE, ORIGIN, en);
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      name: 'A lone lighthouse at sunset',
      contentUrl: `${ORIGIN}/api/v1/media/ast_img`,
      url: `${ORIGIN}/s/gen_01hzzzzzzzzzzzzzzzzzzzzzzz`,
      width: 1280,
      creator: { '@type': 'Person', name: 'Layla' },
      publisher: { '@type': 'Organization', name: 'AIVORE' },
    });
    expect(JSON.stringify(data)).not.toContain('Hassan');
  });

  it('describes a video file as a VideoObject with an upload date and a thumbnail', () => {
    const data = shareJsonLd(CLIP(), ORIGIN, en);
    expect(data).toMatchObject({
      '@type': 'VideoObject',
      thumbnailUrl: `${ORIGIN}/api/v1/media/ast_vid?variant=thumb`,
      encodingFormat: 'video/mp4',
    });
    expect(data).toHaveProperty('uploadDate');
  });

  it('leaves the creator out when the owner has no usable name, and is null without results', () => {
    expect(shareJsonLd({ ...IMAGE, ownerFirstName: null }, ORIGIN, en)).not.toHaveProperty(
      'creator',
    );
    expect(shareJsonLd({ ...IMAGE, outputs: [] }, ORIGIN, en)).toBeNull();
  });
});
