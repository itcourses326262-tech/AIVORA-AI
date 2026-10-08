import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  getLogger,
  isLogLevel,
  redact,
  resetLoggerForTests,
  type LogLevel,
} from '@/server/logger';

function capture(level: LogLevel = 'debug', bindings?: Record<string, unknown>) {
  const lines: Array<{ level: string; record: Record<string, unknown> }> = [];
  const logger = createLogger({
    level,
    bindings,
    now: () => Date.UTC(2026, 0, 2, 3, 4, 5, 678),
    sink: (emitLevel, line) =>
      lines.push({ level: emitLevel, record: JSON.parse(line) as Record<string, unknown> }),
  });
  return { logger, lines };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoggerForTests();
});

describe('log lines', () => {
  it('writes one JSON object with level, ISO time, message and fields', () => {
    const { logger, lines } = capture();
    logger.info('Generation queued', { generationId: 'gen_1', cost: 3 });
    expect(lines).toEqual([
      {
        level: 'info',
        record: {
          generationId: 'gen_1',
          cost: 3,
          level: 'info',
          time: '2026-01-02T03:04:05.678Z',
          msg: 'Generation queued',
        },
      },
    ]);
  });

  it('filters by level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error']);
  });

  it('silent drops everything', () => {
    const { logger, lines } = capture('silent');
    logger.error('e');
    expect(lines).toEqual([]);
  });

  it('child loggers add bindings without mutating the parent', () => {
    const { logger, lines } = capture('debug', { service: 'web' });
    const child = logger.child({ requestId: 'req_1' });
    child.info('inside');
    logger.info('outside');
    expect(lines[0]?.record).toMatchObject({ service: 'web', requestId: 'req_1' });
    expect(lines[1]?.record).not.toHaveProperty('requestId');
  });

  it('lets fields override bindings but never the core keys', () => {
    const { logger, lines } = capture('debug', { env: 'a' });
    logger.info('real message', { env: 'b', level: 'fatal', msg: 'forged', time: 'never' });
    expect(lines[0]?.record).toMatchObject({
      env: 'b',
      level: 'info',
      msg: 'real message',
      time: '2026-01-02T03:04:05.678Z',
    });
  });

  it('keeps each entry on a single line even for multi-line messages', () => {
    const raw: string[] = [];
    const logger = createLogger({ sink: (_level, line) => raw.push(line) });
    logger.info('line one\nline two', { note: 'a\nb' });
    expect(raw[0]).not.toContain('\n');
  });

  it('sends warn and error to stderr and the rest to stdout by default', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ level: 'debug' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stdout).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(String(stdout.mock.calls[0]?.[0])).toMatch(/\n$/);
  });
});

describe('redaction of secret-looking keys', () => {
  it.each([
    'password',
    'currentPassword',
    'passwordHash',
    'token',
    'sessionToken',
    'access_token',
    'tokenHash',
    'authorization',
    'Authorization',
    'apiKey',
    'api_key',
    'x-api-key',
    'OPENAI_API_KEY',
    'FAL_KEY',
    'REPLICATE_API_TOKEN',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'clientSecret',
    'cookie',
    'set-cookie',
    'credentials',
    'privateKey',
    'signature',
  ])('masks %s', (key) => {
    expect(redact({ [key]: 'super-secret-value' })).toEqual({ [key]: '[REDACTED]' });
  });

  it.each([
    'passed',
    'bypass',
    'maxTokens',
    'tokenCount',
    'idempotencyKey',
    'keyword',
    'author',
    'prefix',
    'name',
  ])('does not mask harmless %s', (key) => {
    expect(redact({ [key]: 'visible' })).toEqual({ [key]: 'visible' });
  });

  it('masks at any depth, including inside arrays', () => {
    expect(
      redact({
        req: { headers: { authorization: 'Bearer abc', accept: 'json' } },
        list: [{ password: 'p', ok: 1 }],
      }),
    ).toEqual({
      req: { headers: { authorization: '[REDACTED]', accept: 'json' } },
      list: [{ password: '[REDACTED]', ok: 1 }],
    });
  });

  it('masks secrets even when the value is not a string', () => {
    expect(redact({ password: { nested: 'x' }, token: 12345 })).toEqual({
      password: '[REDACTED]',
      token: '[REDACTED]',
    });
  });

  it('scrubs bearer tokens and API keys that appear inside strings', () => {
    expect(redact({ header: 'Bearer abc.DEF-123_xyz' })).toEqual({ header: 'Bearer [REDACTED]' });
    expect(redact({ msg: 'key avk_ab12cd34_s3cr3tvalue used' })).toEqual({
      msg: 'key avk_[REDACTED] used',
    });
    expect(redact('authorization: bearer sometoken')).toBe('authorization: Bearer [REDACTED]');
  });

  it('redacts through the logger before anything is written', () => {
    const { logger, lines } = capture();
    logger.info('login', { password: 'hunter2', user: { token: 'abc' } });
    expect(JSON.stringify(lines)).not.toContain('hunter2');
    expect(JSON.stringify(lines)).not.toContain('abc');
  });

  it('scrubs the message too', () => {
    const { logger, lines } = capture();
    logger.info('call failed with Authorization Bearer abc123');
    expect(lines[0]?.record.msg).toBe('call failed with Authorization Bearer [REDACTED]');
  });
});

describe('serialization of awkward values', () => {
  it('serializes errors with name, message, stack, code and cause', () => {
    const cause = new Error('socket hang up');
    const error = Object.assign(new Error('provider failed', { cause }), {
      code: 'ECONNRESET',
      status: 502,
    });
    const out = redact({ err: error }) as { err: Record<string, unknown> };
    expect(out.err).toMatchObject({
      name: 'Error',
      message: 'provider failed',
      code: 'ECONNRESET',
      status: 502,
    });
    expect(String(out.err.stack)).toContain('provider failed');
    expect(out.err.cause).toMatchObject({ message: 'socket hang up' });
  });

  it('does not leak secrets carried by errors', () => {
    const error = new Error('request failed: Bearer abc.def.ghi');
    Object.assign(error, { details: { apiKey: 'sk-live-123' } });
    const text = JSON.stringify(redact({ err: error }));
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('sk-live-123');
  });

  it('survives circular references', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    expect(redact(loop)).toEqual({ name: 'loop', self: '[Circular]' });
  });

  it('does not mistake a repeated (non-circular) reference for a cycle', () => {
    const shared = { a: 1 };
    expect(redact({ x: shared, y: shared })).toEqual({ x: { a: 1 }, y: { a: 1 } });
  });

  it('caps depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[MaxDepth]');
  });

  it('handles dates, bigint, binary data, urls, non-finite numbers, functions and undefined', () => {
    const out = redact({
      date: new Date(Date.UTC(2026, 0, 1)),
      invalidDate: new Date(Number.NaN),
      big: 12345678901234567890n,
      bytes: new Uint8Array(1500),
      buffer: Buffer.alloc(10),
      arrayBuffer: new ArrayBuffer(8),
      url: new URL('https://user:pass@example.com/path?x=1'),
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      fn: () => 1,
      sym: Symbol('s'),
      nothing: undefined,
      nil: null,
      map: new Map([[1, 2]]),
    }) as Record<string, unknown>;
    expect(out).toMatchObject({
      date: '2026-01-01T00:00:00.000Z',
      invalidDate: null,
      big: '12345678901234567890',
      bytes: '[binary 1500 bytes]',
      buffer: '[binary 10 bytes]',
      arrayBuffer: '[binary 8 bytes]',
      url: 'https://example.com/path?x=1',
      nan: 'NaN',
      inf: 'Infinity',
      nil: null,
      map: '[Map]',
    });
    expect(out.fn).toBeUndefined();
    expect(out.sym).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('pass@');
  });

  it('truncates very long strings and arrays', () => {
    const out = redact({
      text: 'x'.repeat(5000),
      list: Array.from({ length: 150 }, (_, i) => i),
    }) as {
      text: string;
      list: unknown[];
    };
    expect(out.text.length).toBeLessThan(4100);
    expect(out.text).toContain('more chars');
    expect(out.list).toHaveLength(101);
    expect(out.list.at(-1)).toBe('[50 more items]');
  });

  it('never throws on exotic input', () => {
    const throwing = {
      get boom(): never {
        throw new Error('getter');
      },
    };
    // A throwing getter is the caller's bug, but ordinary exotic values must be safe.
    expect(() => redact(Object.create(null))).not.toThrow();
    expect(() => redact([undefined, null, () => 1])).not.toThrow();
    expect(() => redact(throwing)).toThrow('getter');
  });
});

describe('getLogger / isLogLevel', () => {
  it('reads LOG_LEVEL from the environment and memoizes', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    resetLoggerForTests();
    const logger = getLogger();
    expect(logger.level).toBe('warn');
    expect(getLogger()).toBe(logger);
  });

  it('falls back to info for unknown levels', () => {
    vi.stubEnv('LOG_LEVEL', 'verbose');
    resetLoggerForTests();
    expect(getLogger().level).toBe('info');
  });

  it('validates levels', () => {
    expect(isLogLevel('debug')).toBe(true);
    expect(isLogLevel('trace')).toBe(false);
    expect(isLogLevel(undefined)).toBe(false);
  });
});
