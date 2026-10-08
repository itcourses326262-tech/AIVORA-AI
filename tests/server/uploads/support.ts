import { crc32 } from 'node:zlib';
import sharp from 'sharp';

type Rgb = [number, number, number];

const noLimit = { limitInputPixels: false } as const;

/** Left half red, right half blue: makes rotation and cropping visible in pixel tests. */
async function twoToneRaw(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const color: Rgb = x < width / 2 ? [255, 0, 0] : [0, 0, 255];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }
  return raw;
}

export async function twoTone(width: number, height: number) {
  return sharp(await twoToneRaw(width, height), { raw: { width, height, channels: 3 } });
}

export async function makePng(width = 32, height = 16): Promise<Uint8Array> {
  return new Uint8Array(await (await twoTone(width, height)).png().toBuffer());
}

export async function makeJpeg(
  width = 32,
  height = 16,
  options: { orientation?: number; exif?: boolean; comment?: string } = {},
): Promise<Uint8Array> {
  let image = (await twoTone(width, height)).jpeg({ quality: 90 });
  if (options.exif) {
    image = image.withExif({
      IFD0: { Artist: 'SECRET-ARTIST', Copyright: 'SECRET-COPYRIGHT' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 28/1 0/1' },
    });
  }
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  const bytes = await image.toBuffer();
  return new Uint8Array(options.comment ? insertJpegComment(bytes, options.comment) : bytes);
}

/** A COM segment right after SOI: where a PHP/HTML payload hides in a real polyglot. */
function insertJpegComment(jpeg: Buffer, text: string): Buffer {
  const payload = Buffer.from(text);
  const header = Buffer.from([0xff, 0xfe, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

export async function makeWebp(width = 32, height = 16): Promise<Uint8Array> {
  return new Uint8Array(await (await twoTone(width, height)).webp().toBuffer());
}

async function frames(count: number) {
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      sharp({
        create: { width: 12, height: 12, channels: 3, background: colors[index % colors.length]! },
      })
        .png()
        .toBuffer(),
    ),
  );
}

export async function makeAnimatedWebp(count = 3): Promise<Uint8Array> {
  const buffer = await sharp(await frames(count), { join: { animated: true } })
    .webp({ loop: 0, delay: Array.from({ length: count }, () => 100) })
    .toBuffer();
  return new Uint8Array(buffer);
}

export async function makeAnimatedGif(count = 3): Promise<Uint8Array> {
  const buffer = await sharp(await frames(count), { join: { animated: true } })
    .gif({ loop: 0, delay: Array.from({ length: count }, () => 100) })
    .toBuffer();
  return new Uint8Array(buffer);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG whose control chunk announces an animation (APNG). */
export async function makeApng(): Promise<Uint8Array> {
  const png = Buffer.from(await makePng(8, 8));
  const afterIhdr = 8 + 25;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  return new Uint8Array(
    Buffer.concat([png.subarray(0, afterIhdr), pngChunk('acTL', actl), png.subarray(afterIhdr)]),
  );
}

/** A structurally valid PNG that declares an absurd size but carries almost no data. */
export function makeDeclaredHugePng(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** A genuinely decodable but enormous image that compresses to a few hundred KB. */
export async function makeBombPng(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: '#000000' },
    ...noLimit,
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(buffer);
}

export const concat = (...parts: Uint8Array[]): Uint8Array => new Uint8Array(Buffer.concat(parts));
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export function toFile(bytes: Uint8Array, name = 'photo.png', type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

export const SVG = utf8(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
);

/** The first bytes of an MP4: size, `ftyp`, brand. Enough to be recognised, not to be played. */
export function fakeMp4(body = 'frames'.repeat(100)): Uint8Array {
  return concat(
    new Uint8Array([0, 0, 0, 0x18]),
    utf8('ftypisom'),
    new Uint8Array([0, 0, 0, 0]),
    utf8('isomiso2'),
    utf8(body),
  );
}

/** Pixel at (x, y) of an encoded image, as [r, g, b]. */
export async function pixelAt(bytes: Uint8Array, x: number, y: number): Promise<Rgb> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 3;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

/** A square PNG of Gaussian noise: barely compressible, so its byte size tracks its area. */
export async function makeNoisyPng(side: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width: side,
      height: side,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();
  return new Uint8Array(buffer);
}
