import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, normalizeIp, resetProxyHeaderWarningForTests } from '@/server/security/ip';
import { getEnv, resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvForTests();
  resetLoggerForTests();
  resetProxyHeaderWarningForTests();
});

const SECRET = 'a-production-grade-secret-0123456789abcdef0123';

function withEnv(values: Record<string, string>): void {
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  resetEnvForTests();
}

function request(headers: Record<string, string> = {}, extra: object = {}): Request {
  return Object.assign(new Request('http://localhost:3000/api/v1/x', { headers }), extra);
}

describe('normalizeIp', () => {
  it('accepts IPv4, with or without a port', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6 to the IPv4 address', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(normalizeIp('[::ffff:203.0.113.7]:443')).toBe('203.0.113.7');
  });

  it('collapses IPv6 to its /64 so one subscriber has one budget', () => {
    const a = normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    const b = normalizeIp('2001:DB8:1:2:0:0:0:1');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(b).toBe(a);
    expect(normalizeIp('2001:db8:1:3::1')).not.toBe(a);
    expect(normalizeIp('[2001:db8:1:2::9]:8080')).toBe(a);
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::/64');
    expect(normalizeIp('::1')).toBe('::/64');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::/64');
  });

  it('rejects everything that is not an address', () => {
    for (const bad of [
      '',
      ' ',
      'unknown',
      'localhost',
      '999.1.1.1',
      '1.2.3',
      '1.2.3.4.5',
      '1.2.3.4/24',
      '<script>',
      '1.2.3.4, 5.6.7.8',
      'a'.repeat(100),
      '::g',
      '1::2::3',
      '12345::',
    ]) {
      expect(normalizeIp(bad), bad).toBeNull();
    }
  });
});

describe('getClientIp without TRUST_PROXY (the default)', () => {
  it('never believes forwarding headers, which any client can send', () => {
    withEnv({ TRUST_PROXY: 'false' });
    const spoofed = request({
      'x-forwarded-for': '6.6.6.6',
      'x-real-ip': '7.7.7.7',
      forwarded: 'for=8.8.8.8',
      'cf-connecting-ip': '9.9.9.9',
    });
    expect(getClientIp(spoofed)).toBe('unknown');
  });

  it('uses the connection address when the platform provides one', () => {
    withEnv({ TRUST_PROXY: 'false' });
    expect(getClientIp(request({ 'x-forwarded-for': '6.6.6.6' }, { ip: '198.51.100.20' }))).toBe(
      '198.51.100.20',
    );
    expect(getClientIp(request({}, { ip: '2001:db8:5:6::7' }))).toBe('2001:db8:5:6::/64');
  });

  it('ignores a provided address that is not one', () => {
    withEnv({ TRUST_PROXY: 'false' });
    expect(getClientIp(request({}, { ip: 'not-an-ip' }))).toBe('unknown');
    expect(getClientIp(request({}, { ip: 42 }))).toBe('unknown');
  });
});

describe('getClientIp with TRUST_PROXY=true', () => {
  it('takes the right-most X-Forwarded-For entry: the one the trusted proxy appended', () => {
    withEnv({ TRUST_PROXY: 'true' });
    // The client wrote "1.1.1.1, 2.2.2.2" itself; the proxy appended the address it really saw.
    expect(getClientIp(request({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' }))).toBe(
      '203.0.113.9',
    );
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('skips nothing silently: an invalid right-most entry means "unknown", not a spoofable left one', () => {
    withEnv({ TRUST_PROXY: 'true' });
    expect(getClientIp(request({ 'x-forwarded-for': '1.1.1.1, garbage' }))).toBe('unknown');
    expect(getClientIp(request({ 'x-forwarded-for': '1.1.1.1,' }))).toBe('1.1.1.1');
  });

  it('counts TRUSTED_PROXY_HOPS from the right when several proxies are in front', () => {
    withEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_HOPS: '2' });
    // client -> CDN (appends client) -> nginx (appends CDN) -> app
    expect(getClientIp(request({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9, 10.0.0.2' }))).toBe(
      '203.0.113.9',
    );
    // Fewer entries than hops: the left-most is all there is.
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('reads X-Forwarded-For only: X-Real-IP is never consulted', () => {
    withEnv({ TRUST_PROXY: 'true' });
    // Next.js fills X-Forwarded-For with the proxy's own address when the proxy sent none, so a
    // fallback to X-Real-IP could not be reached in production, and where it could (a runtime
    // that does not do that) the header is client-controlled unless the proxy overwrites it.
    expect(getClientIp(request({ 'x-real-ip': '203.0.113.10' }))).toBe('unknown');
    expect(getClientIp(request({ 'x-forwarded-for': '', 'x-real-ip': '203.0.113.10' }))).toBe(
      'unknown',
    );
    expect(
      getClientIp(request({ 'x-forwarded-for': 'garbage', 'x-real-ip': '203.0.113.10' })),
    ).toBe('unknown');
    expect(getClientIp(request())).toBe('unknown');
  });

  it('uses the connection address, when the platform provides one, if there is no usable header', () => {
    withEnv({ TRUST_PROXY: 'true' });
    expect(getClientIp(request({}, { ip: '198.51.100.20' }))).toBe('198.51.100.20');
    expect(getClientIp(request({ 'x-forwarded-for': 'garbage' }, { ip: '198.51.100.20' }))).toBe(
      '198.51.100.20',
    );
    expect(
      getClientIp(request({ 'x-forwarded-for': '203.0.113.9' }, { ip: '198.51.100.20' })),
    ).toBe('203.0.113.9');
  });

  it('ignores a spoofed X-Real-IP next to X-Forwarded-For and handles IPv6 and ports', () => {
    withEnv({ TRUST_PROXY: 'true' });
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '1.1.1.1' }))).toBe(
      '203.0.113.9',
    );
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.9:4711' }))).toBe('203.0.113.9');
    expect(getClientIp(request({ 'x-forwarded-for': '2001:db8:aa:bb:1:2:3:4' }))).toBe(
      '2001:db8:aa:bb::/64',
    );
  });

  it('cannot be tricked into huge or malformed keys', () => {
    withEnv({ TRUST_PROXY: 'true' });
    expect(getClientIp(request({ 'x-forwarded-for': 'x'.repeat(5000) }))).toBe('unknown');
    expect(getClientIp(request({ 'x-forwarded-for': '1.2.3.4 ; DROP' }))).toBe('unknown');
  });
});

describe('the warning about ignored forwarding headers', () => {
  /** Calls getClientIp for each request and returns the warnings the logger wrote. */
  function warningsFor(env: Record<string, string>, requests: Request[]): string[] {
    withEnv({ LOG_LEVEL: 'warn', ...env });
    resetLoggerForTests();
    resetProxyHeaderWarningForTests();
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    getEnv(); // the start-up warnings (env.ts) are not what is under test
    write.mockClear();
    for (const req of requests) getClientIp(req);
    return write.mock.calls.map(([chunk]) => (JSON.parse(String(chunk)) as { msg: string }).msg);
  }

  const behindProxy = () => request({ 'x-forwarded-for': '203.0.113.9' });

  it('is logged ONCE in production when TRUST_PROXY is false but X-Forwarded-For is present', () => {
    const messages = warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET }, [
      behindProxy(),
      behindProxy(),
      request({ 'x-real-ip': '203.0.113.10' }),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/all clients share one rate-limit bucket/);
    expect(messages[0]).toMatch(/set TRUST_PROXY=true behind your proxy/i);
    expect(messages[0]).toMatch(/X-Forwarded-For/);
  });

  it('also reacts to X-Real-IP alone', () => {
    const messages = warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET }, [
      request({ 'x-real-ip': '203.0.113.10' }),
    ]);
    expect(messages).toHaveLength(1);
  });

  it('never leaks the forwarded address into the log', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    withEnv({ LOG_LEVEL: 'warn', NODE_ENV: 'production', SESSION_SECRET: SECRET });
    resetLoggerForTests();
    resetProxyHeaderWarningForTests();
    getEnv();
    write.mockClear();
    getClientIp(request({ 'x-forwarded-for': '203.0.113.99' }));
    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('203.0.113.99');
  });

  it('stays quiet without forwarding headers, with TRUST_PROXY=true and outside production', () => {
    expect(warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET }, [request()])).toEqual(
      [],
    );
    expect(
      warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET, TRUST_PROXY: 'true' }, [
        behindProxy(),
      ]),
    ).toEqual([]);
    expect(warningsFor({ NODE_ENV: 'development' }, [behindProxy()])).toEqual([]);
    expect(warningsFor({ NODE_ENV: 'test' }, [behindProxy()])).toEqual([]);
  });

  it('does not change the answer: the header is still never believed', () => {
    warningsFor({ NODE_ENV: 'production', SESSION_SECRET: SECRET }, []);
    expect(getClientIp(behindProxy())).toBe('unknown');
  });
});
