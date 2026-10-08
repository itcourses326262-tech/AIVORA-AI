import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, normalizeIp } from '@/server/security/ip';
import { resetEnvForTests } from '@/server/env';

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

function withEnv(values: Record<string, string>): void {
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

  it('falls back to X-Real-IP, and to unknown when neither header is usable', () => {
    withEnv({ TRUST_PROXY: 'true' });
    expect(getClientIp(request({ 'x-real-ip': '203.0.113.10' }))).toBe('203.0.113.10');
    expect(getClientIp(request({ 'x-forwarded-for': '', 'x-real-ip': '203.0.113.10' }))).toBe(
      '203.0.113.10',
    );
    expect(getClientIp(request({ 'x-real-ip': 'nope' }))).toBe('unknown');
    expect(getClientIp(request())).toBe('unknown');
  });

  it('prefers X-Forwarded-For over X-Real-IP and handles IPv6 and ports', () => {
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
