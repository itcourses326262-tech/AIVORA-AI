// gifenc ships no type declarations. Do not import it directly: use `@/lib/gifenc`, which
// normalises the module-shape differences between runtimes (enforced by an ESLint rule).
//
// Gotcha: prequantize()/applyPalette() view `rgba.buffer` as a whole Uint32Array and ignore
// byteOffset/length, so the RGBA array must own its ArrayBuffer (pass `new Uint8Array(buf)`
// rather than a pooled Node Buffer or a subarray).

declare module 'gifenc' {
  export type RgbColor = [number, number, number];
  export type RgbaColor = [number, number, number, number];
  export type Palette = RgbColor[] | RgbaColor[];
  export type PixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';
  export type DistanceFn = (a: number[], b: number[]) => number;

  export interface QuantizeOptions {
    format?: PixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface PrequantizeOptions {
    roundRGB?: number;
    roundAlpha?: number;
    oneBitAlpha?: boolean | number | null;
  }

  export interface GifEncoderOptions {
    /** Write the header and first-frame metadata automatically (default true). */
    auto?: boolean;
    initialCapacity?: number;
  }

  export interface WriteFrameOptions {
    /** Colour table for this frame; required on the first frame. */
    palette?: Palette;
    /** Only used when the encoder was created with `auto: false`. */
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Frame delay in milliseconds. */
    delay?: number;
    /** -1 = play once, 0 = loop forever, n > 0 = repeat n times. */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifStream {
    readonly buffer: ArrayBuffer;
    reset(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeByte(byte: number): void;
    writeBytes(data: ArrayLike<number>, offset?: number, byteLength?: number): void;
    writeBytesView(data: Uint8Array, offset?: number, byteLength?: number): void;
  }

  export interface GifEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBuffer;
    readonly stream: GifStream;
    writeHeader(): void;
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
  }

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): Palette;
  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    options?: PrequantizeOptions,
  ): void;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array;
  export function nearestColorIndex(
    palette: Palette,
    pixel: RgbColor | RgbaColor,
    distanceFn?: DistanceFn,
  ): number;
  export function nearestColorIndexWithDistance(
    palette: Palette,
    pixel: RgbColor | RgbaColor,
    distanceFn?: DistanceFn,
  ): [number, number];
  export function nearestColor(
    palette: Palette,
    pixel: RgbColor | RgbaColor,
    distanceFn?: DistanceFn,
  ): RgbColor | RgbaColor | undefined;
  export function snapColorsToPalette(
    palette: Palette,
    knownColors: Palette,
    threshold?: number,
  ): void;

  const gifenc: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    prequantize: typeof prequantize;
    applyPalette: typeof applyPalette;
    nearestColorIndex: typeof nearestColorIndex;
    nearestColorIndexWithDistance: typeof nearestColorIndexWithDistance;
    nearestColor: typeof nearestColor;
    snapColorsToPalette: typeof snapColorsToPalette;
  };
  export default gifenc;
}
