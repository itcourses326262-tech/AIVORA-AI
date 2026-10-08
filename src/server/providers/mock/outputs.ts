import 'server-only';
import type { ProviderInput, ProviderOutput } from '../types';
import { ProviderError } from '../errors';
import { ARTWORK_MIME_TYPE, renderArtwork } from './image/art';
import { transformImage } from './image/transform';
import { stripTriggers } from './job';
import { hash32, subSeed, toSeed } from './random';
import { mockImageSize, videoSizeForRatio } from './size';
import { encodeGif } from './video/gif';
import { renderImageVideoFrames } from './video/ken-burns';
import { frameCountFor } from './video/pace';
import { renderTextVideoFrames } from './video/text-scene';

const MAX_IMAGES = 4;
const DEFAULT_DURATION_SEC = 3;
/** Ordered-dither strength in colour levels: smooth generated scenes need more than photographs. */
const SCENE_DITHER = 8;
const PHOTO_DITHER = 6;

/** The seed of a request: the caller's, or a stable one derived from the generation id. */
export function resolveSeed(input: ProviderInput): number {
  const { seed } = input.params;
  return seed === undefined ? hash32('mock-seed', input.generationId) : toSeed(seed);
}

export function requiresInputImage(tool: ProviderInput['tool']): boolean {
  return tool === 'image-to-image' || tool === 'image-to-video';
}

/** How many images to make: `count` within 1..4, and one for anything that is not a number. */
export function clampImageCount(count: number): number {
  return Number.isFinite(count) ? Math.min(MAX_IMAGES, Math.max(1, Math.trunc(count))) : 1;
}

function durationSec(input: ProviderInput): number {
  const { durationSec: requested } = input.params;
  const fallback = input.model.limits.defaultDuration ?? DEFAULT_DURATION_SEC;
  return requested !== undefined && Number.isFinite(requested) && requested > 0
    ? requested
    : fallback;
}

async function textToImage(input: ProviderInput, seed: number): Promise<ProviderOutput[]> {
  const { width, height } = mockImageSize(input.params.aspectRatio);
  const outputs: ProviderOutput[] = [];
  for (let index = 0; index < clampImageCount(input.params.count); index++) {
    const imageSeed = subSeed(seed, index);
    const bytes = await renderArtwork({
      prompt: input.prompt,
      ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),
      seed: imageSeed,
      width,
      height,
    });
    outputs.push({
      kind: 'image',
      bytes,
      mimeType: ARTWORK_MIME_TYPE,
      width,
      height,
      seed: imageSeed,
    });
  }
  return outputs;
}

async function imageToImage(
  input: ProviderInput,
  inputImage: NonNullable<ProviderInput['inputImage']>,
  seed: number,
): Promise<ProviderOutput[]> {
  const outputs: ProviderOutput[] = [];
  for (let index = 0; index < clampImageCount(input.params.count); index++) {
    const imageSeed = subSeed(seed, index);
    const edited = await transformImage({
      imageBytes: inputImage.bytes,
      prompt: input.prompt,
      ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),
      seed: imageSeed,
      ...(input.params.strength === undefined ? {} : { strength: input.params.strength }),
    });
    outputs.push({
      kind: 'image',
      bytes: edited.bytes,
      mimeType: ARTWORK_MIME_TYPE,
      width: edited.width,
      height: edited.height,
      seed: imageSeed,
    });
  }
  return outputs;
}

async function textToVideo(
  input: ProviderInput,
  seed: number,
  signal: AbortSignal,
): Promise<ProviderOutput[]> {
  const seconds = durationSec(input);
  const frames = frameCountFor(seconds);
  const { width, height } = videoSizeForRatio(input.params.aspectRatio);
  const rendered = await renderTextVideoFrames({
    prompt: input.prompt,
    ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),
    seed,
    width,
    height,
    frames,
    signal,
  });
  const bytes = await encodeGif({
    frames: rendered,
    width,
    height,
    delayMs: (seconds * 1000) / frames,
    dither: SCENE_DITHER,
    signal,
  });
  return [
    {
      kind: 'video',
      bytes,
      mimeType: 'image/gif',
      width,
      height,
      durationMs: seconds * 1000,
      seed,
    },
  ];
}

async function imageToVideo(
  input: ProviderInput,
  inputImage: NonNullable<ProviderInput['inputImage']>,
  seed: number,
  signal: AbortSignal,
): Promise<ProviderOutput[]> {
  const seconds = durationSec(input);
  const frames = frameCountFor(seconds);
  const clip = await renderImageVideoFrames({
    imageBytes: inputImage.bytes,
    seed,
    frames,
    signal,
  });
  const bytes = await encodeGif({
    frames: clip.frames,
    width: clip.width,
    height: clip.height,
    delayMs: (seconds * 1000) / frames,
    dither: PHOTO_DITHER,
    signal,
  });
  return [
    {
      kind: 'video',
      bytes,
      mimeType: 'image/gif',
      width: clip.width,
      height: clip.height,
      durationMs: seconds * 1000,
      seed,
    },
  ];
}

/** Renders the outputs of one request. Pure in (input, seed): the same request gives the same bytes. */
export async function generateOutputs(
  request: ProviderInput,
  seed: number,
  signal: AbortSignal,
): Promise<ProviderOutput[]> {
  const input = { ...request, prompt: stripTriggers(request.prompt) };
  const { inputImage } = input;
  if (requiresInputImage(input.tool) && !inputImage) {
    throw new ProviderError('invalid_input', `The ${input.tool} tool needs an input image`, {
      userMessage: 'This tool needs an input image.',
    });
  }
  signal.throwIfAborted();
  switch (input.tool) {
    case 'text-to-image':
      return textToImage(input, seed);
    case 'image-to-image':
      return imageToImage(input, inputImage as NonNullable<typeof inputImage>, seed);
    case 'text-to-video':
      return textToVideo(input, seed, signal);
    case 'image-to-video':
      return imageToVideo(input, inputImage as NonNullable<typeof inputImage>, seed, signal);
  }
}
