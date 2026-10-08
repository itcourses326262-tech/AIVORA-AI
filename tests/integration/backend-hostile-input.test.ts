import { describe, expect, it, vi } from 'vitest';
import type { AssetDTO, GenerationDTO } from '@/lib/api-types';
import { newId } from '@/lib/id';
import { makePng } from '../server/uploads/support';
import { Client, dataOf, type Reply } from './helpers/api';
import { createWorld, runToCompletion, textToImage, type Member } from './helpers/world';

// Odd, hostile and malformed input at every route. The contract is narrow and universal: the
// answer is a client error in the standard envelope (or a success), never a 5xx, and nothing the
// attacker sent shows up in a server log line at error level.

vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();

const NUL = '\u0000';
const BIDI = '‮';
const HUGE_KEY = '__proto__';

function expectHandled(reply: Reply, context: string): void {
  expect(reply.status, `${context}: ${reply.text.slice(0, 200)}`).toBeLessThan(500);
  if (reply.status >= 400) {
    expect(reply.json?.error?.code, context).toEqual(expect.any(String));
    expect(reply.json?.error?.message, context).toEqual(expect.any(String));
  }
}

async function scene(): Promise<{ alice: Member; done: GenerationDTO; input: AssetDTO }> {
  const alice = await world.signUp('Alice');
  const input = dataOf(await alice.upload<AssetDTO>(await makePng(32, 24)), 201);
  const queued = dataOf(
    await alice.post<GenerationDTO>('/generations', textToImage('a lake')),
    201,
  );
  const done = await runToCompletion(alice, queued.id, world.runner());
  return { alice, done, input };
}

describe('query strings', () => {
  const queries: Array<[string, Record<string, string | readonly string[]>]> = [
    ['a NUL in the search', { q: `lake${NUL}shore` }],
    ['LIKE wildcards in the search', { q: '%_\\%_\\' }],
    ['a very long search', { q: 'x'.repeat(5_000) }],
    ['bidi controls in the search', { q: `${BIDI}lake` }],
    ['an emoji search', { q: '🌅🌊' }],
    ['a repeated status', { status: ['queued', 'failed'] }],
    ['an array limit', { limit: ['1', '2'] }],
    ['an exponent limit', { limit: '1e9' }],
    ['a NaN limit', { limit: 'NaN' }],
    ['a negative limit', { limit: '-5' }],
    ['a fractional limit', { limit: '2.5' }],
    ['an unknown kind', { kind: 'audio' }],
    ['a junk cursor', { cursor: '!!!not-base64!!!' }],
    ['a cursor of the wrong shape', { cursor: Buffer.from('["a","b"]').toString('base64url') }],
    [
      'a cursor with a huge number',
      { cursor: Buffer.from('[1e400,"gen_x"]').toString('base64url') },
    ],
    ['a cursor with an object', { cursor: Buffer.from('{"createdAt":1}').toString('base64url') }],
    ['a very long cursor', { cursor: 'A'.repeat(5_000) }],
    ['ids with NUL and spaces', { ids: `${NUL}, ,gen_` }],
    ['an empty ids', { ids: '' }],
    ['the prototype key', { [HUGE_KEY]: 'x', constructor: 'y' }],
  ];

  it('GET /generations and /explore answer every one without a server error', async () => {
    const { alice } = await scene();
    for (const [name, query] of queries) {
      expectHandled(await alice.get('/generations', { query }), `/generations ${name}`);
      expectHandled(await world.anonymous().get('/explore', { query }), `/explore ${name}`);
    }
  });
});

describe('bodies', () => {
  const bodies: Array<[string, unknown]> = [
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '42'],
    ['a string', '"hello"'],
    ['an empty object', '{}'],
    ['a prototype key', '{"__proto__":{"admin":true},"tool":"text-to-image"}'],
    ['a deeply nested object', `${'{"a":'.repeat(500)}1${'}'.repeat(500)}`],
    [
      'a prompt that is an object',
      '{"tool":"text-to-image","modelId":"aivore-demo-image","prompt":{"$gt":""}}',
    ],
    [
      'params that are an array',
      '{"tool":"text-to-image","modelId":"aivore-demo-image","prompt":"x","params":[1]}',
    ],
    ['a NUL in the prompt', JSON.stringify(textToImage(`lake${NUL}shore`))],
    [
      'a huge number',
      '{"tool":"text-to-image","modelId":"aivore-demo-image","prompt":"x","params":{"seed":1e999}}',
    ],
    [
      'lone surrogates',
      '{"tool":"text-to-image","modelId":"aivore-demo-image","prompt":"\\ud800 lake"}',
    ],
    [
      'an asset id with path characters',
      JSON.stringify(textToImage('x', { inputAssetId: '../../etc/passwd' })),
    ],
    ['invalid UTF-8', new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d])],
  ];

  it('every JSON endpoint answers each of them without a server error', async () => {
    const alice = await world.signUp('Alice');
    const stranger = new Client();
    const headers = { 'content-type': 'application/json' };
    for (const [name, body] of bodies) {
      const post = (client: Client, path: string) => client.post(path, body, { headers });
      expectHandled(await post(alice, '/generations'), `generations ${name}`);
      expectHandled(await post(alice, '/keys'), `keys ${name}`);
      expectHandled(await alice.patch('/account', body, { headers }), `account ${name}`);
      expectHandled(await post(alice, '/prompt/enhance'), `enhance ${name}`);
      expectHandled(await post(alice, '/account/password'), `password ${name}`);
      expectHandled(await post(stranger, '/auth/register'), `register ${name}`);
      expectHandled(await post(stranger, '/auth/login'), `login ${name}`);
    }
  });

  it('PATCH /generations/:id with unusable bodies', async () => {
    const { alice, done } = await scene();
    for (const body of [
      'null',
      '[]',
      '{}',
      '{"isPublic":"true"}',
      '{"isPublic":1}',
      '{"isFavorite":null}',
      '{"userId":"usr_x","isPublic":true}',
      '{"__proto__":{"isPublic":true}}',
    ]) {
      const reply = await alice.patch(`/generations/${done.id}`, body, {
        headers: { 'content-type': 'application/json' },
      });
      expectHandled(reply, `PATCH ${body}`);
      expect(reply.status, body).toBe(422);
    }
    expect(dataOf(await alice.get<GenerationDTO>(`/generations/${done.id}`)).isPublic).toBe(false);
  });

  it('registration and key names with odd characters are stored or refused, never a crash', async () => {
    const stranger = new Client();
    for (const name of [
      `Ali${NUL}ce`,
      `${BIDI}Mallory`,
      '​​',
      '🌅',
      'x'.repeat(10_000),
      '<script>',
    ]) {
      expectHandled(
        await stranger.post('/auth/register', {
          email: `odd${Math.abs(name.length)}${name.codePointAt(0)}@example.com`,
          password: 'Correct-horse-battery-9',
          name,
        }),
        `register name ${JSON.stringify(name.slice(0, 20))}`,
      );
    }
    const alice = await world.signUp('Alice');
    for (const name of [`k${NUL}`, `${BIDI}key`, '​', '🔑', 'x'.repeat(10_000), '']) {
      expectHandled(
        await alice.post('/keys', { name }),
        `key name ${JSON.stringify(name.slice(0, 20))}`,
      );
    }
  });
});

describe('paths and headers', () => {
  it('odd ids in the path are 404s', async () => {
    const { alice } = await scene();
    const ids = [
      NUL,
      '%00',
      '../../etc/passwd',
      'x'.repeat(5_000),
      'gen_',
      '🌅',
      'GEN_ABC',
      newId('ast'),
    ];
    for (const id of ids) {
      for (const [method, path] of [
        ['GET', `/generations/${encodeURIComponent(id)}`],
        ['PATCH', `/generations/${encodeURIComponent(id)}`],
        ['DELETE', `/generations/${encodeURIComponent(id)}`],
        ['POST', `/generations/${encodeURIComponent(id)}/cancel`],
        ['DELETE', `/keys/${encodeURIComponent(id)}`],
      ] as const) {
        const reply = await alice.request(
          method,
          path,
          method === 'PATCH' ? { body: { isFavorite: true } } : {},
        );
        expectHandled(reply, `${method} ${path.slice(0, 60)}`);
        expect([404, 422]).toContain(reply.status);
      }
      const media = await alice.media(`/media/${encodeURIComponent(id)}`);
      expect(media.status, `media ${id.slice(0, 20)}`).toBe(404);
    }
  });

  it('odd Range, conditional and variant parameters on media never crash it', async () => {
    const { alice, done } = await scene();
    const url = done.outputs[0]?.url ?? '';
    const ranges = [
      'bytes=0-0,5-9',
      'bytes=-0',
      'bytes=9999999999999999999-',
      'bytes=a-b',
      'bytes=5-1',
      'items=0-5',
      'bytes=',
      'bytes=0-',
      'bytes= 0 - 5',
      `bytes=${'9'.repeat(400)}-`,
      'x'.repeat(8_000),
    ];
    for (const range of ranges) {
      const reply = await alice.media(url, { headers: { range } });
      expect([200, 206, 416], `range ${range.slice(0, 40)}`).toContain(reply.status);
    }
    const conditionals: Array<Record<string, string>> = [
      { 'if-range': 'garbage', range: 'bytes=0-9' },
      { 'if-range': '"nope"', range: 'bytes=0-9' },
      { 'if-none-match': 'x'.repeat(100_000) },
      { 'if-none-match': '*' },
      { 'if-none-match': 'W/"a", W/"b", ,' },
    ];
    for (const headers of conditionals) {
      const reply = await alice.media(url, { headers });
      expect([200, 206, 304, 416]).toContain(reply.status);
    }
    for (const query of [
      'variant=THUMB',
      'variant=',
      'variant=thumb&variant=x',
      'download=maybe',
      'x=1&x=2',
    ]) {
      const reply = await alice.media(`${url}?${query}`);
      expect(reply.status, query).toBeLessThan(500);
    }
  });

  it('odd request ids and content types are tolerated', async () => {
    const alice = await world.signUp('Alice');
    for (const id of ['', 'x'.repeat(10_000), 'a b', 'café', 'line\tbreak']) {
      const reply = await alice.get('/generations', { headers: { 'x-request-id': id } });
      expectHandled(reply, `request id ${id.slice(0, 10)}`);
      expect(reply.headers.get('x-request-id')).toBeTruthy();
      expect((reply.headers.get('x-request-id') ?? '').length).toBeLessThan(200);
    }
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      '',
    ]) {
      const reply = await alice.post('/generations', JSON.stringify(textToImage('a lake')), {
        headers: { 'content-type': type },
      });
      expectHandled(reply, `content type ${type}`);
    }
  });
});
