import 'server-only';
import sharp from 'sharp';
import { invalidInputImage, decodeToRaw, probeDisplaySize } from '../input-image';
import { createRng, hash32 } from '../random';
import { vignetteFactors } from '../shading';
import { videoSizeFor } from '../size';
import { yieldToEventLoop } from './pace';

const TAU = Math.PI * 2;
/** The source is kept a little larger than the frames so that zooming in does not blur it. */
const WORKING_LONGEST_SIDE = 640;

export interface KenBurnsRequest {
  imageBytes: Uint8Array;
  seed: number;
  frames: number;
  signal?: AbortSignal;
}

export interface RenderedClip {
  frames: Uint8Array[];
  width: number;
  height: number;
}

/** Brightness of the picture as a smooth "depth" guess: bright things lean toward the camera. */
async function depthFromLuminance(rgba: Uint8Array, width: number, height: number) {
  try {
    const { data } = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .removeAlpha()
      .greyscale()
      .blur(Math.max(1, Math.max(width, height) / 90))
      .normalise()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } catch (error) {
    throw invalidInputImage(error);
  }
}

/**
 * The Demo image-to-video clip: a slow push-in with a drifting pan, a gentle parallax (brighter
 * regions shift more than darker ones as the virtual camera sways) and a soft light sweep. The
 * zoom, pan, sway and sweep all return to their start, so the GIF loops seamlessly. The frames keep
 * the input's proportions, scaled to 480 px on the longest side.
 */
export async function renderImageVideoFrames(request: KenBurnsRequest): Promise<RenderedClip> {
  const { imageBytes, seed, frames, signal } = request;
  const display = await probeDisplaySize(imageBytes);
  const { width, height } = videoSizeFor(display.width, display.height);
  const longest = Math.max(display.width, display.height);
  const scale = Math.min(1, WORKING_LONGEST_SIDE / longest);
  const source = await decodeToRaw(
    imageBytes,
    {
      width: Math.max(2, Math.round(display.width * scale)),
      height: Math.max(2, Math.round(display.height * scale)),
    },
    { flatten: true },
  );
  const depth = await depthFromLuminance(source.data, source.width, source.height);

  const rng = createRng(hash32('mock-kenburns', seed, display.width, display.height));
  const zoomAmount = rng.range(0.1, 0.17);
  const heading = rng.range(0, TAU);
  const panX = Math.cos(heading) * 0.8;
  const panY = Math.sin(heading) * 0.8;
  const parallax = source.width * rng.range(0.008, 0.014);
  const sweepAngle = rng.range(0.35, 1.2);
  const sweepX = Math.cos(sweepAngle) / (Math.cos(sweepAngle) + Math.sin(sweepAngle));
  const sweepY = Math.sin(sweepAngle) / (Math.cos(sweepAngle) + Math.sin(sweepAngle));
  const vignette = vignetteFactors(width, height, 0.38);
  // Position of every pixel along the sweep direction, 0 (one corner) to 1 (the opposite one).
  const along = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      along[y * width + x] = ((x + 0.5) / width) * sweepX + ((y + 0.5) / height) * sweepY;
    }
  }

  const sw = source.width;
  const sh = source.height;
  const src = source.data;
  const maxX = sw - 1;
  const maxY = sh - 1;
  const output: Uint8Array[] = [];

  for (let frame = 0; frame < frames; frame++) {
    signal?.throwIfAborted();
    const theta = (frame / frames) * TAU;
    const ease = 0.5 - 0.5 * Math.cos(theta);
    const zoom = 1 + zoomAmount * ease;
    const windowW = sw / zoom;
    const windowH = sh / zoom;
    const centerX = sw / 2 + ((sw - windowW) / 2) * panX;
    const centerY = sh / 2 + ((sh - windowH) / 2) * panY;
    const left = centerX - windowW / 2;
    const top = centerY - windowH / 2;
    const swayX = Math.sin(theta) * parallax * 2;
    const swayY = Math.cos(theta) * parallax * 0.9;
    const sweepAt = -0.3 + 1.6 * (frame / frames);

    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const sy0 = top + ((y + 0.5) * windowH) / height - 0.5;
      const rowDepth = Math.min(maxY, Math.max(0, Math.round(sy0))) * sw;
      for (let x = 0; x < width; x++) {
        const sx0 = left + ((x + 0.5) * windowW) / width - 0.5;
        const lean = depth[rowDepth + Math.min(maxX, Math.max(0, Math.round(sx0)))]! / 255 - 0.5;
        const sx = Math.min(maxX, Math.max(0, sx0 + lean * swayX));
        const sy = Math.min(maxY, Math.max(0, sy0 + lean * swayY));
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(maxX, x0 + 1);
        const y1 = Math.min(maxY, y0 + 1);
        const fx = sx - x0;
        const fy = sy - y0;
        const a = (y0 * sw + x0) * 4;
        const b = (y0 * sw + x1) * 4;
        const c = (y1 * sw + x0) * 4;
        const d = (y1 * sw + x1) * 4;
        const pixel = y * width + x;
        const distance = along[pixel]! - sweepAt;
        const light = 1 + 0.16 * Math.exp(-(distance * distance) / 0.03);
        const factor = vignette[pixel]! * light;
        const o = pixel * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top2 = src[a + ch]! + (src[b + ch]! - src[a + ch]!) * fx;
          const bottom = src[c + ch]! + (src[d + ch]! - src[c + ch]!) * fx;
          rgba[o + ch] = Math.min(255, (top2 + (bottom - top2) * fy) * factor);
        }
        rgba[o + 3] = 255;
      }
    }
    output.push(rgba);
    await yieldToEventLoop();
  }
  return { frames: output, width, height };
}
