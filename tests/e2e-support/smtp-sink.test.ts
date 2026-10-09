import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodeHeaderValue,
  parseMessage,
  startSmtpSink,
  type SinkMessage,
  type SmtpSink,
} from '../../e2e/support/smtp-sink';

/**
 * The end-to-end `smtp` project reads the confirmation link out of what this sink received, so the
 * sink must decode exactly what the application's real transport (nodemailer) sends: Arabic
 * subjects, long HTML lines that are quoted-printable encoded, base64 parts and dot-stuffed lines.
 */

let directory: string;
let sink: SmtpSink;
let file: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'aivore-sink-test-'));
  file = join(directory, 'sink.jsonl');
  sink = await startSmtpSink({ port: 0, file });
});

afterEach(async () => {
  await sink.close();
  rmSync(directory, { recursive: true, force: true });
});

function received(): SinkMessage[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as SinkMessage);
}

function transport() {
  return createTransport({ host: '127.0.0.1', port: sink.port, secure: false, ignoreTLS: true });
}

describe('SMTP sink', () => {
  it('receives a message from nodemailer with subject, text and HTML decoded', async () => {
    const link = 'https://aivore.example.com/verify-email?token=AbC_123-xyz&next=%2Fstudio';
    await transport().sendMail({
      from: 'AIVORE <no-reply@aivore.example.com>',
      to: 'layla@example.com',
      subject: 'Confirm your email address',
      text: `Open this link to confirm:\n${link}\n`,
      html: `<p>Open <a href="${link}">this link</a> to confirm.</p>`,
    });

    expect(received()).toMatchObject([
      {
        from: 'no-reply@aivore.example.com',
        to: 'layla@example.com',
        subject: 'Confirm your email address',
        text: `Open this link to confirm:\n${link}\n`,
        html: `<p>Open <a href="${link}">this link</a> to confirm.</p>`,
      },
    ]);
  });

  it('decodes Arabic subjects and bodies, and very long lines that arrive quoted-printable', async () => {
    const long = `https://aivore.example.com/verify-email?token=${'a1B2c3D4_-'.repeat(30)}`;
    await transport().sendMail({
      from: 'no-reply@aivore.example.com',
      to: 'ليلى@example.com',
      subject: 'أكّد بريدك الإلكتروني ✓',
      text: `مرحباً بك في أيفور\n${long}`,
      html: `<p dir="rtl">مرحباً بك</p><a href="${long}">${long}</a>`,
    });

    const [message] = received();
    expect(message?.subject).toBe('أكّد بريدك الإلكتروني ✓');
    expect(message?.text).toBe(`مرحباً بك في أيفور\n${long}`);
    expect(message?.html).toBe(`<p dir="rtl">مرحباً بك</p><a href="${long}">${long}</a>`);
  });

  it('keeps a line that starts with a dot, which SMTP sends doubled', async () => {
    await transport().sendMail({
      from: 'no-reply@aivore.example.com',
      to: 'a@example.com',
      subject: 'dots',
      text: 'first\n.hidden\n..two\nlast',
    });
    expect(received()[0]?.text).toBe('first\n.hidden\n..two\nlast');
  });

  it('takes several messages on one connection and in parallel, in the order they finish', async () => {
    const mailer = createTransport({
      host: '127.0.0.1',
      port: sink.port,
      secure: false,
      ignoreTLS: true,
      pool: true,
      maxConnections: 3,
    });
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((index) =>
        mailer.sendMail({
          from: 'no-reply@aivore.example.com',
          to: `user${index}@example.com`,
          subject: `Message ${index}`,
          text: `Body ${index}`,
        }),
      ),
    );
    mailer.close();
    expect(
      received()
        .map((message) => message.to)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5, 6].map((index) => `user${index}@example.com`));
  });
});

describe('MIME decoding', () => {
  it('reads RFC 2047 words in both encodings and joins adjacent ones', () => {
    expect(decodeHeaderValue('=?UTF-8?B?2YXYsdit2KjYpw==?=')).toBe('مرحبا');
    expect(decodeHeaderValue('=?utf-8?Q?Caf=C3=A9_au_lait?=')).toBe('Café au lait');
    expect(decodeHeaderValue('=?utf-8?Q?one?= =?utf-8?Q?two?=')).toBe('onetwo');
    expect(decodeHeaderValue('plain subject')).toBe('plain subject');
  });

  it('collects the text and HTML parts of nested multipart messages and base64 bodies', () => {
    const raw = [
      'From: a@example.com',
      'Subject: =?UTF-8?Q?Hello_there?=',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('plain body').toString('base64'),
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<a href=3D"https://x.example/?a=3Db">link</a>=',
      ' tail',
      '--inner--',
      '--outer--',
      '',
    ].join('\r\n');
    expect(parseMessage(raw)).toEqual({
      subject: 'Hello there',
      text: 'plain body',
      html: '<a href="https://x.example/?a=b">link</a> tail',
    });
  });

  it('answers an unknown part or a message without a boundary with empty bodies, not an exception', () => {
    expect(parseMessage('Subject: x\r\nContent-Type: multipart/mixed\r\n\r\nbody')).toEqual({
      subject: 'x',
      text: '',
      html: '',
    });
    expect(parseMessage('Subject: only headers')).toEqual({
      subject: 'only headers',
      text: '',
      html: '',
    });
  });
});
