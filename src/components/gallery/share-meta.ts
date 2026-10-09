/**
 * What the public share page tells crawlers and link previews: the title and description, the
 * Open Graph and Twitter cards, and the schema.org description of the picture or video. Everything
 * is built from a {@link PublicCreation}, so the owner's name appears at most as a first name, and
 * every address is absolute (a preview fetched by another site cannot resolve a relative one).
 */
import type { Metadata } from 'next';
import type { AssetDTO } from '@/lib/api-types';
import { clipText } from '@/lib/generations/format';
import { presentationOf } from '@/lib/generations/media';
import type { Translator } from '@/lib/i18n';
import { sharePath } from './links';
import { modelInfo } from './model-info';
import type { PublicCreation } from './public-creation';

const OG_LOCALE = { ar: 'ar_AR', en: 'en_US' } as const;

/** Titles stay under what search results and previews show. */
const TITLE_CHARS = 70;
const DESCRIPTION_PROMPT_CHARS = 140;

export interface ShareImage {
  url: string;
  width?: number;
  height?: number;
  type?: string;
}

/** `/api/v1/media/<id>` as an address on this deployment. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

/**
 * The picture a link preview shows. A picture result is used as it is; a video is represented by
 * its still frame, or by itself when it is an animated image. A video file without a still has no
 * preview picture (null): a video file is not an image, and a preview would show a broken one.
 */
export function previewImage(creation: PublicCreation, origin: string): ShareImage | null {
  const asset = creation.outputs[0];
  if (!asset) return null;
  if (creation.kind === 'image') {
    return {
      url: absoluteUrl(origin, asset.url),
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      type: asset.mimeType,
    };
  }
  if (asset.thumbUrl) return { url: absoluteUrl(origin, asset.thumbUrl), type: 'image/webp' };
  return presentationOf(asset) === 'animated-image'
    ? { url: absoluteUrl(origin, asset.url), type: asset.mimeType }
    : null;
}

export function shareMetadata(
  creation: PublicCreation,
  origin: string,
  { t, locale }: Pick<Translator, 't' | 'locale'>,
): Metadata {
  const title = clipText(creation.prompt, TITLE_CHARS);
  const description = t('gallery.public.meta.description', {
    model: modelInfo(creation.modelId).label,
    prompt: clipText(creation.prompt, DESCRIPTION_PROMPT_CHARS),
  });
  const path = sharePath(creation.id);
  const image = previewImage(creation, origin);
  const alt = t(
    creation.kind === 'video'
      ? 'studio.generations.media.videoPreview'
      : 'studio.generations.media.image',
    { index: 1, prompt: title },
  );
  const siteName = t('common.app.name');
  return {
    title,
    description,
    alternates: { canonical: path },
    // Only a finished, shared creation has a page at all, so there is always something to index.
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url: absoluteUrl(origin, path),
      siteName,
      title: `${title} · ${siteName}`,
      description,
      locale: OG_LOCALE[locale],
      ...(image ? { images: [{ ...image, alt }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: `${title} · ${siteName}`,
      description,
      ...(image ? { images: [{ url: image.url, alt }] } : {}),
    },
  };
}

function schemaFile(asset: AssetDTO, origin: string): Record<string, unknown> {
  return {
    contentUrl: absoluteUrl(origin, asset.url),
    encodingFormat: asset.mimeType,
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
  };
}

/** schema.org `ImageObject` / `VideoObject` for the first result. Null when there is none. */
export function shareJsonLd(
  creation: PublicCreation,
  origin: string,
  { t }: Pick<Translator, 't'>,
): Record<string, unknown> | null {
  const asset = creation.outputs[0];
  if (!asset) return null;
  const image = previewImage(creation, origin);
  const video = creation.kind === 'video' && presentationOf(asset) === 'video';
  return {
    '@context': 'https://schema.org',
    '@type': video ? 'VideoObject' : 'ImageObject',
    name: clipText(creation.prompt, TITLE_CHARS),
    description: creation.prompt,
    url: absoluteUrl(origin, sharePath(creation.id)),
    ...(video ? { uploadDate: new Date(creation.createdAt).toISOString() } : {}),
    datePublished: new Date(creation.createdAt).toISOString(),
    ...(image ? { thumbnailUrl: image.url } : {}),
    ...schemaFile(asset, origin),
    ...(creation.ownerFirstName
      ? { creator: { '@type': 'Person', name: creation.ownerFirstName } }
      : {}),
    publisher: { '@type': 'Organization', name: t('common.app.name'), url: origin },
  };
}
