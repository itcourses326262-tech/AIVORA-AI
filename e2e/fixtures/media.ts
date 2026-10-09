import { expect, type Locator } from '@playwright/test';

/** True once every matched element is an `<img>` that has decoded real pixels. */
export async function expectImagesLoaded(images: Locator, count?: number): Promise<void> {
  if (count === undefined) await expect(images.first()).toBeVisible();
  else await expect(images).toHaveCount(count);
  await expect
    .poll(
      () =>
        images.evaluateAll((elements) =>
          elements.map((element) =>
            element instanceof HTMLImageElement && element.complete ? element.naturalWidth : 0,
          ),
        ),
      { message: 'every image should have decoded real pixels (naturalWidth > 0)' },
    )
    .not.toContain(0);
}

/** The natural size of the first matched image. */
export async function naturalSize(image: Locator): Promise<{ width: number; height: number }> {
  return image.evaluate((element) =>
    element instanceof HTMLImageElement
      ? { width: element.naturalWidth, height: element.naturalHeight }
      : { width: 0, height: 0 },
  );
}

/**
 * Counts the pictures of a GIF by walking its blocks (header, screen descriptor, extensions and image
 * descriptors), so "motion preview" means more than "the file starts with GIF89a".
 * Returns 0 for anything that is not a well-formed GIF.
 */
export function countGifFrames(bytes: Uint8Array): number {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return 0;
  const byteAt = (index: number): number => bytes[index] ?? 0;
  let position = 13;
  if (byteAt(10) & 0x80) position += 3 * 2 ** ((byteAt(10) & 0x07) + 1);

  const skipSubBlocks = (from: number): number => {
    let at = from;
    while (at < bytes.length && byteAt(at) !== 0) at += byteAt(at) + 1;
    return at + 1;
  };

  let frames = 0;
  while (position < bytes.length) {
    const marker = byteAt(position);
    if (marker === 0x3b) return frames;
    if (marker === 0x21) {
      position = skipSubBlocks(position + 2);
    } else if (marker === 0x2c) {
      frames += 1;
      const flags = byteAt(position + 9);
      position += 10;
      if (flags & 0x80) position += 3 * 2 ** ((flags & 0x07) + 1);
      position = skipSubBlocks(position + 1);
    } else {
      return 0;
    }
  }
  return 0;
}
