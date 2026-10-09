import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface StoredObject {
  bytes: Buffer;
  contentType: string;
  generation: number;
}

export interface FakeGcsServer {
  /** Value for STORAGE_EMULATOR_HOST. */
  readonly host: string;
  readonly bucket: string;
  readonly objects: Map<string, StoredObject>;
  /** Every request as `METHOD path`, in order. */
  readonly requests: string[];
  /** The Range header of each media download, in order. */
  readonly ranges: Array<string | undefined>;
  /** Answer the next `times` uploads with this HTTP status. */
  failUploads(status: number, times?: number): void;
  /** Answer the next `times` media downloads with this HTTP status. */
  failDownloads(status: number, times?: number): void;
  /** Ignore Range headers and answer 200 with the whole object, like a misbehaving proxy. */
  ignoreRange: boolean;
  /** Forget injected failures. */
  reset(): void;
  /** Never answer media downloads (until the test closes the server). */
  stallDownloads: boolean;
  /** Send downloads slowly: `chunk` bytes every `delayMs`. */
  slowDownloads: { chunk: number; delayMs: number } | undefined;
  /** Media downloads currently being sent. */
  activeDownloads: number;
  /** The `authorization` header of each request, in order. */
  readonly authorizations: Array<string | undefined>;
  close(): Promise<void>;
}

function jsonError(res: ServerResponse, code: number, message: string) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message, errors: [{ message, reason: 'notFound' }] } }));
}

/** CRC32C (Castagnoli), written out here so the stand-in does not depend on the SDK it tests. */
const CRC32C_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
  return value >>> 0;
});

function crc32cOf(bytes: Buffer): string {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC32C_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  const out = Buffer.alloc(4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return out.toString('base64');
}

function metadataOf(bucket: string, name: string, object: StoredObject) {
  return {
    kind: 'storage#object',
    name,
    bucket,
    generation: String(object.generation),
    size: String(object.bytes.byteLength),
    contentType: object.contentType,
    crc32c: crc32cOf(object.bytes),
    md5Hash: createHash('md5').update(object.bytes).digest('base64'),
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The JSON part and the media part of a multipart/related upload. */
function parseMultipart(body: Buffer, contentType: string) {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2];
  if (!boundary) throw new Error('no boundary');
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    // Each part is "\r\n<headers>\r\n\r\n<content>\r\n" between two delimiters.
    parts.push(body.subarray(start + 2, next - 2));
    at = next;
  }
  const split = (part: Buffer) => {
    const end = part.indexOf('\r\n\r\n');
    return { headers: part.subarray(0, end).toString(), content: part.subarray(end + 4) };
  };
  const [meta, media] = parts.map(split);
  if (!meta || !media) throw new Error('expected two parts');
  return {
    metadata: JSON.parse(meta.content.toString()) as { contentType?: string },
    media: media.content,
    mediaType: /content-type:\s*([^\r\n]+)/i.exec(media.headers)?.[1]?.trim(),
  };
}

/** `bytes=a-b`, `bytes=a-`, `bytes=-n` against `size`; null when it cannot be satisfied. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const count = Number(match[2]);
    if (count === 0 || size === 0) return null;
    return { start: Math.max(0, size - count), end: size - 1 };
  }
  const start = Number(match[1]);
  if (start >= size) return null;
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return end < start ? null : { start, end };
}

/**
 * A small stand-in for the Cloud Storage JSON API on 127.0.0.1: object metadata, media download
 * with ranges and generations, multipart upload with checksum, delete, and Google's 404 wording
 * for a missing bucket. The real SDK talks to it through STORAGE_EMULATOR_HOST.
 */
export async function startFakeGcsServer(bucket = 'demo-project.firebasestorage.app') {
  const objects = new Map<string, StoredObject>();
  const requests: string[] = [];
  const ranges: Array<string | undefined> = [];
  const uploadFailures: Array<{ status: number; times: number }> = [];
  const downloadFailures: Array<{ status: number; times: number }> = [];
  const authorizations: Array<string | undefined> = [];
  let generation = 7000;

  function sendBody(res: ServerResponse, body: Buffer) {
    const slow = fake.slowDownloads;
    if (!slow) return res.end(body);
    fake.activeDownloads += 1;
    let at = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      fake.activeDownloads -= 1;
    };
    const timer = setInterval(() => {
      if (at >= body.byteLength) {
        finish();
        res.end();
        return;
      }
      res.write(body.subarray(at, at + slow.chunk));
      at += slow.chunk;
    }, slow.delayMs);
    res.once('close', finish);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    authorizations.push(req.headers.authorization);
    const route = /^(?:\/upload)?(?:\/storage\/v1)?\/b\/([^/]+)\/o(?:\/(.+))?$/.exec(url.pathname);
    if (!route) return jsonError(res, 404, 'Not Found');
    const bucketName = decodeURIComponent(route[1] as string);
    if (bucketName !== bucket) return jsonError(res, 404, 'The specified bucket does not exist.');
    const upload = url.pathname.startsWith('/upload/');

    if (upload && req.method === 'POST') {
      const body = await readBody(req);
      const failure = uploadFailures.find((entry) => entry.times > 0);
      if (failure) {
        failure.times -= 1;
        return jsonError(res, failure.status, 'Injected failure');
      }
      const name = url.searchParams.get('name') ?? '';
      const parsed = parseMultipart(body, req.headers['content-type'] ?? '');
      generation += 1;
      const object: StoredObject = {
        bytes: Buffer.from(parsed.media),
        contentType: parsed.metadata.contentType ?? parsed.mediaType ?? 'application/octet-stream',
        generation,
      };
      objects.set(name, object);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(metadataOf(bucket, name, object)));
    }

    const name = route[2] === undefined ? undefined : decodeURIComponent(route[2]);
    if (name === undefined) return jsonError(res, 404, 'Not Found');
    const object = objects.get(name);
    const pinned = url.searchParams.get('generation');
    const visible = object && (pinned === null || pinned === String(object.generation));

    if (req.method === 'DELETE') {
      if (!visible) return jsonError(res, 404, `No such object: ${bucket}/${name}`);
      objects.delete(name);
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET') {
      if (!visible || !object) return jsonError(res, 404, `No such object: ${bucket}/${name}`);
      if (url.searchParams.get('alt') !== 'media') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(metadataOf(bucket, name, object)));
      }
      const failure = downloadFailures.find((entry) => entry.times > 0);
      if (failure) {
        failure.times -= 1;
        return jsonError(res, failure.status, 'Injected failure');
      }
      if (fake.stallDownloads) return;
      const header = fake.ignoreRange ? undefined : req.headers.range;
      ranges.push(req.headers.range);
      const headers = {
        'content-type': object.contentType,
        'x-goog-generation': String(object.generation),
        'x-goog-stored-content-encoding': 'identity',
        'x-goog-hash': `crc32c=${crc32cOf(object.bytes)}`,
      };
      if (header) {
        const range = parseRange(header, object.bytes.byteLength);
        if (!range) {
          res.writeHead(416, { 'content-range': `bytes */${object.bytes.byteLength}` });
          return res.end();
        }
        const slice = object.bytes.subarray(range.start, range.end + 1);
        res.writeHead(206, {
          ...headers,
          'content-length': slice.byteLength,
          'content-range': `bytes ${range.start}-${range.end}/${object.bytes.byteLength}`,
        });
        return sendBody(res, slice);
      }
      res.writeHead(200, { ...headers, 'content-length': object.bytes.byteLength });
      return sendBody(res, object.bytes);
    }
    return jsonError(res, 405, 'Method Not Allowed');
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const fake: FakeGcsServer = {
    host: `http://127.0.0.1:${port}`,
    bucket,
    objects,
    requests,
    ranges,
    authorizations,
    ignoreRange: false,
    stallDownloads: false,
    slowDownloads: undefined,
    activeDownloads: 0,
    reset() {
      uploadFailures.length = 0;
      downloadFailures.length = 0;
      fake.ignoreRange = false;
      fake.stallDownloads = false;
      fake.slowDownloads = undefined;
    },
    failUploads(status, times = 1) {
      uploadFailures.push({ status, times });
    },
    failDownloads(status, times = 1) {
      downloadFailures.push({ status, times });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return fake;
}
