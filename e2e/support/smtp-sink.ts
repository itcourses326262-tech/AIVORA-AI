import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

/**
 * A tiny SMTP server that accepts every message and writes it, decoded, as one JSON line to a
 * file. The `smtp` end-to-end project points the application at it (`SMTP_URL`), which is what
 * switches e-mail confirmation on (`EMAIL_VERIFICATION=auto` is "required" exactly when SMTP is
 * configured) and puts the real SMTP transport on the path of every message. Nothing leaves the
 * machine. It speaks just enough of RFC 5321 for nodemailer: no authentication, no TLS.
 */

export interface SinkMessage {
  at: number;
  /** The envelope sender. */
  from: string;
  /** The first envelope recipient (a message of this application has exactly one). */
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SmtpSink {
  port: number;
  close(): Promise<void>;
}

export interface SmtpSinkOptions {
  port: number;
  /** The JSON-lines file the messages are appended to. */
  file: string;
  /** Defaults to the loopback address: the sink must never be reachable from outside. */
  host?: string;
}

const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 30_000;
const END_OF_DATA = Buffer.from('\r\n.\r\n');

// ---- Decoding -------------------------------------------------------------------------------

function quotedPrintableBytes(input: string): Buffer {
  const joined = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < joined.length; index += 1) {
    const hex = joined.slice(index + 1, index + 3);
    if (joined[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(joined.charCodeAt(index) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** RFC 2047 encoded words (`=?utf-8?B?...?=`, `=?utf-8?Q?...?=`) in a header value. */
export function decodeHeaderValue(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?[^?]+\?([bBqQ])\?([^?]*)\?=/g, (_word, kind: string, payload: string) =>
      kind.toLowerCase() === 'b'
        ? Buffer.from(payload, 'base64').toString('utf8')
        : quotedPrintableBytes(payload.replace(/_/g, ' ')).toString('utf8'),
    );
}

function decodeBody(body: string, encoding: string): string {
  switch (encoding.trim().toLowerCase()) {
    case 'quoted-printable':
      return quotedPrintableBytes(body).toString('utf8');
    case 'base64':
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    default:
      return body;
  }
}

interface MimeEntity {
  headers: Map<string, string>;
  body: string;
}

function splitEntity(source: string): MimeEntity {
  const boundary = source.indexOf('\r\n\r\n');
  const headerText = boundary === -1 ? source : source.slice(0, boundary);
  const body = boundary === -1 ? '' : source.slice(boundary + 4);
  const headers = new Map<string, string>();
  for (const line of headerText.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0)
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body };
}

function collectText(entity: MimeEntity, found: { text: string; html: string }): void {
  const type = (entity.headers.get('content-type') ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const marker = /boundary="?([^";]+)"?/i.exec(entity.headers.get('content-type') ?? '')?.[1];
    if (!marker) return;
    for (const piece of entity.body.split(`--${marker}`).slice(1)) {
      if (piece.startsWith('--')) break;
      // The line break before a delimiter belongs to the delimiter, not to the part.
      collectText(splitEntity(piece.replace(/^\r\n/, '').replace(/\r\n$/, '')), found);
    }
    return;
  }
  const decoded = decodeBody(
    entity.body,
    entity.headers.get('content-transfer-encoding') ?? '7bit',
  ).replace(/\r\n/g, '\n');
  if (type.startsWith('text/html')) found.html += decoded;
  else if (type.startsWith('text/plain')) found.text += decoded;
}

/** The subject and the text and HTML bodies of a raw RFC 5322 message. */
export function parseMessage(raw: string): Pick<SinkMessage, 'subject' | 'text' | 'html'> {
  const entity = splitEntity(raw);
  const found = { text: '', html: '' };
  collectText(entity, found);
  return { subject: decodeHeaderValue(entity.headers.get('subject') ?? ''), ...found };
}

// ---- The protocol ---------------------------------------------------------------------------

function address(argument: string): string {
  return /<([^>]*)>/.exec(argument)?.[1] ?? argument.replace(/^[^:]*:/, '').trim();
}

function handleConnection(socket: Socket, deliver: (message: SinkMessage) => void): void {
  let buffer = Buffer.alloc(0);
  let from = '';
  let recipients: string[] = [];
  let inData = false;
  socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  const reply = (line: string) => socket.write(`${line}\r\n`);

  const finishData = (data: Buffer) => {
    // Undo dot-stuffing: a line that began with "." was sent with a second one.
    const raw = data.toString('utf8').replace(/(^|\r\n)\.\./g, '$1.');
    deliver({
      at: Date.now(),
      from,
      to: recipients[0] ?? '',
      ...parseMessage(raw),
    });
    from = '';
    recipients = [];
    reply('250 2.0.0 queued');
  };

  const readCommands = () => {
    for (;;) {
      if (inData) {
        const end = buffer.indexOf(END_OF_DATA);
        if (end === -1) {
          if (buffer.length > MAX_MESSAGE_BYTES) {
            reply('552 5.3.4 message too large');
            socket.destroy();
          }
          return;
        }
        const data = buffer.subarray(0, end);
        buffer = buffer.subarray(end + END_OF_DATA.length);
        inData = false;
        finishData(data);
        continue;
      }
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd === -1) return;
      const line = buffer.subarray(0, lineEnd).toString('utf8');
      buffer = buffer.subarray(lineEnd + 2);
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === 'EHLO' || verb === 'HELO') reply('250 smtp-sink');
      else if (verb === 'MAIL') {
        from = address(line.slice(4));
        recipients = [];
        reply('250 2.1.0 ok');
      } else if (verb === 'RCPT') {
        recipients.push(address(line.slice(4)));
        reply('250 2.1.5 ok');
      } else if (verb === 'DATA') {
        inData = true;
        reply('354 end data with <CR><LF>.<CR><LF>');
      } else if (verb === 'RSET' || verb === 'NOOP') reply('250 2.0.0 ok');
      else if (verb === 'QUIT') {
        reply('221 2.0.0 bye');
        socket.end();
        return;
      } else reply('502 5.5.2 command not recognised');
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    readCommands();
  });
  reply('220 smtp-sink ESMTP ready');
}

/** Starts the sink; resolves once it is listening (`port` 0 picks a free one, see `SmtpSink.port`). */
export function startSmtpSink(options: SmtpSinkOptions): Promise<SmtpSink> {
  mkdirSync(dirname(options.file), { recursive: true });
  const deliver = (message: SinkMessage) =>
    appendFileSync(options.file, `${JSON.stringify(message)}\n`, { mode: 0o600 });
  const open = new Set<Socket>();
  const server: Server = createServer((socket) => {
    open.add(socket);
    socket.once('close', () => open.delete(socket));
    handleConnection(socket, deliver);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '127.0.0.1', () => {
      const bound = server.address();
      resolve({
        port: typeof bound === 'object' && bound ? bound.port : options.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            for (const socket of open) socket.destroy();
          }),
      });
    });
  });
}
