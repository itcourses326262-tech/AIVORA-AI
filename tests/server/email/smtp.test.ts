import { createServer, type Server } from 'node:net';
import type * as LoggerModule from '@/server/logger';
import { describe, expect, it, vi } from 'vitest';
import {
  createSmtpTransport,
  isSingleAddress,
  smtpSettingsFromEnv,
  renderEmail,
  sendEmail,
  setEmailTransportOverride,
  getEmailTransport,
  setEmailTimingForTests,
  type EmailMessage,
  type OutgoingEmail,
} from '@/server/email';
import { resetEnvForTests } from '@/server/env';
import { cleanEmailState } from './support';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  return { ...original, getLogger: () => ({ ...log, level: 'debug', child: () => log }) };
});

cleanEmailState();

const base = {
  SMTP_URL: undefined,
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_SECURE: false,
};

function outgoing(to = 'layla@example.com'): OutgoingEmail {
  const message: EmailMessage = renderEmail({
    kind: 'verification',
    locale: 'ar',
    to,
    name: 'ليلى',
    link: 'https://aivore.example/verify-email?token=abc',
    ttlHours: 24,
    bonusCredits: 50,
  });
  return { ...message, from: 'AIVORE <no-reply@aivore.example>' };
}

describe('smtpSettingsFromEnv', () => {
  it('is null without SMTP_URL or SMTP_HOST', () => {
    expect(smtpSettingsFromEnv(base)).toBeNull();
  });

  it('reads a URL: host, port, TLS mode and percent-encoded credentials', () => {
    expect(
      smtpSettingsFromEnv({ ...base, SMTP_URL: 'smtp://us%40er:p%3Ass@mail.example.com:2525' }),
    ).toEqual({
      host: 'mail.example.com',
      port: 2525,
      secure: false,
      requireTLS: true,
      auth: { user: 'us@er', pass: 'p:ss' },
    });
    expect(
      smtpSettingsFromEnv({ ...base, SMTP_URL: 'smtps://u:p@mail.example.com' }),
    ).toMatchObject({
      port: 465,
      secure: true,
      requireTLS: false,
    });
    expect(smtpSettingsFromEnv({ ...base, SMTP_URL: 'smtp://mail.example.com' })).toEqual({
      host: 'mail.example.com',
      port: 587,
      secure: false,
      requireTLS: false,
    });
  });

  it('reads the separate variables, with the usual default ports', () => {
    expect(
      smtpSettingsFromEnv({
        ...base,
        SMTP_HOST: 'mail.example.com',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        SMTP_SECURE: true,
      }),
    ).toEqual({
      host: 'mail.example.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: 'u', pass: 'p' },
    });
    expect(smtpSettingsFromEnv({ ...base, SMTP_HOST: 'h', SMTP_PORT: 25 })).toMatchObject({
      port: 25,
      secure: false,
    });
  });

  it('prefers the URL over the separate variables', () => {
    expect(
      smtpSettingsFromEnv({ ...base, SMTP_URL: 'smtp://url-host', SMTP_HOST: 'other-host' }),
    ).toMatchObject({ host: 'url-host' });
  });

  it('never sends credentials over a connection that cannot be encrypted', () => {
    expect(
      smtpSettingsFromEnv({ ...base, SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }),
    ).toMatchObject({
      requireTLS: true,
    });
  });
});

describe('isSingleAddress', () => {
  it.each(['a@example.com', 'first.last+tag@sub.example.co.uk'])('accepts %s', (address) =>
    expect(isSingleAddress(address)).toBe(true),
  );

  it.each([
    'a@example.com, b@example.com',
    'a@example.com;b@example.com',
    'a@example.com\r\nBcc: evil@example.com',
    'Layla <a@example.com>',
    '"a b"@example.com',
    'a@@example.com',
    'no-at-sign',
    '@example.com',
    '',
    `${'a'.repeat(250)}@example.com`,
  ])('refuses %j', (address) => expect(isSingleAddress(address)).toBe(false));
});

describe('createSmtpTransport with a stub transporter', () => {
  const settings = { host: 'h', port: 587, secure: false, requireTLS: false };

  it('sends text and html with auto-responder headers, to one address', async () => {
    const sendMail = vi.fn(async () => ({ accepted: ['layla@example.com'], rejected: [] }));
    const transport = createSmtpTransport(settings, {
      createTransporter: async () => ({ sendMail }),
    });
    await transport.send(outgoing());
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = (sendMail.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent).toMatchObject({
      from: 'AIVORE <no-reply@aivore.example>',
      to: 'layla@example.com',
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    expect(String(sent.html)).toContain('<html lang="ar" dir="rtl">');
    expect(String(sent.text)).toContain('token=abc');
  });

  it('builds the transporter once and reuses it', async () => {
    const create = vi.fn(async () => ({
      sendMail: vi.fn(async () => ({ accepted: ['a@example.com'], rejected: [] })),
    }));
    const transport = createSmtpTransport(settings, { createTransporter: create });
    await transport.send(outgoing('a@example.com'));
    await transport.send(outgoing('b@example.com'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('forgets a transporter that failed to load, so the next message tries again', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('cannot load'))
      .mockResolvedValue({
        sendMail: vi.fn(async () => ({ accepted: ['a@example.com'], rejected: [] })),
      });
    const transport = createSmtpTransport(settings, { createTransporter: create });
    await expect(transport.send(outgoing('a@example.com'))).rejects.toThrow('cannot load');
    await expect(transport.send(outgoing('a@example.com'))).resolves.toBeUndefined();
  });

  it('fails when the server rejects the recipient', async () => {
    const transport = createSmtpTransport(settings, {
      createTransporter: async () => ({
        sendMail: vi.fn(async () => ({ accepted: [], rejected: ['layla@example.com'] })),
      }),
    });
    await expect(transport.send(outgoing())).rejects.toThrow(/did not accept/);
  });

  it.each(['a@example.com, b@example.com', 'a@example.com\r\nBcc: x@y.z', 'Layla <a@example.com>'])(
    'refuses to send to %j before touching the network',
    async (to) => {
      const create = vi.fn();
      const transport = createSmtpTransport(settings, { createTransporter: create });
      await expect(transport.send({ ...outgoing(), to })).rejects.toThrow(/malformed address/);
      expect(create).not.toHaveBeenCalled();
    },
  );
});

/** A just-enough SMTP server on the loopback interface (no outside network is involved). */
function fakeSmtpServer(options: { rejectRecipient?: boolean } = {}) {
  const received: string[] = [];
  let connections = 0;
  const server: Server = createServer((socket) => {
    connections += 1;
    socket.setEncoding('utf8');
    socket.write('220 fake.test ESMTP\r\n');
    let buffer = '';
    let data: string | null = null;
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== null) {
          if (line === '.') {
            received.push(data);
            data = null;
            socket.write('250 2.0.0 queued\r\n');
          } else {
            data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO' || command === 'HELO') socket.write('250 fake.test\r\n');
        else if (command === 'MAIL') socket.write('250 ok\r\n');
        else if (command === 'RCPT') {
          socket.write(options.rejectRecipient ? '550 5.1.1 no such mailbox\r\n' : '250 ok\r\n');
        } else if (command === 'DATA') {
          data = '';
          socket.write('354 go ahead\r\n');
        } else if (command === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise<{
    port: number;
    received: string[];
    connections: () => number;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        received,
        connections: () => connections,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

describe('real nodemailer against a local SMTP server', () => {
  it('delivers a bilingual multipart message', async () => {
    const server = await fakeSmtpServer();
    try {
      const transport = createSmtpTransport({
        host: '127.0.0.1',
        port: server.port,
        secure: false,
        requireTLS: false,
      });
      await transport.send(outgoing());
      expect(server.received).toHaveLength(1);
      const raw = server.received[0] ?? '';
      expect(raw).toMatch(/^From: .*no-reply@aivore\.example/m);
      expect(raw).toMatch(/^To: layla@example\.com/m);
      expect(raw).toMatch(/^Auto-Submitted: auto-generated/m);
      expect(raw).toMatch(/Content-Type: multipart\/alternative/);
      expect(raw).toMatch(/Content-Type: text\/plain/);
      expect(raw).toMatch(/Content-Type: text\/html/);
      // The subject is Arabic, so it travels encoded; it must not contain a raw line break.
      expect(raw).toMatch(/^Subject: =\?UTF-8\?/m);
    } finally {
      await server.close();
    }
  });

  it('is the transport an SMTP_URL selects, and reports a refused recipient without retrying', async () => {
    const server = await fakeSmtpServer({ rejectRecipient: true });
    try {
      vi.stubEnv('SMTP_URL', `smtp://127.0.0.1:${server.port}`);
      vi.stubEnv('EMAIL_FROM', 'AIVORE <no-reply@aivore.example>');
      resetEnvForTests();
      setEmailTransportOverride(null);
      expect(getEmailTransport().name).toBe('smtp');
      setEmailTimingForTests({ retryDelayMs: 0, timeoutMs: 5_000 });

      const result = await sendEmail(outgoing());
      expect(result.ok).toBe(false);
      // A 5xx answer will not change by asking again: one connection only.
      expect(server.connections()).toBe(1);
    } finally {
      await server.close();
    }
  });
});
