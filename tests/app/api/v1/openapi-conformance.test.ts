/**
 * The document against the real routes: each scenario calls a route handler the way Next.js does
 * (real authentication, CSRF check, rate limiter, database, storage) and checks that the status
 * is one the document lists for that operation, that the headers and the JSON body match what is
 * documented, and that the documented budget is the one that was spent. A last test insists that
 * every operation was exercised, so a new endpoint cannot hide from this file.
 */
import { describe, expect, it } from 'vitest';
import * as account from '@/app/api/v1/account/route';
import * as accountExport from '@/app/api/v1/account/export/route';
import * as accountLedger from '@/app/api/v1/account/ledger/route';
import * as accountPassword from '@/app/api/v1/account/password/route';
import * as authForgot from '@/app/api/v1/auth/password/forgot/route';
import * as authReset from '@/app/api/v1/auth/password/reset/route';
import * as authLogin from '@/app/api/v1/auth/login/route';
import * as authLogout from '@/app/api/v1/auth/logout/route';
import * as authLogoutAll from '@/app/api/v1/auth/logout-all/route';
import * as authMe from '@/app/api/v1/auth/me/route';
import * as authRegister from '@/app/api/v1/auth/register/route';
import * as verifyConfirm from '@/app/api/v1/auth/verify-email/confirm/route';
import * as verifyRequest from '@/app/api/v1/auth/verify-email/request/route';
import * as explore from '@/app/api/v1/explore/route';
import * as generationCancel from '@/app/api/v1/generations/[id]/cancel/route';
import * as generation from '@/app/api/v1/generations/[id]/route';
import * as generations from '@/app/api/v1/generations/route';
import * as keyById from '@/app/api/v1/keys/[id]/route';
import * as keys from '@/app/api/v1/keys/route';
import * as media from '@/app/api/v1/media/[assetId]/route';
import * as models from '@/app/api/v1/models/route';
import * as openapi from '@/app/api/v1/openapi.json/route';
import * as enhance from '@/app/api/v1/prompt/enhance/route';
import * as tools from '@/app/api/v1/tools/route';
import * as uploads from '@/app/api/v1/uploads/route';
import { createApiKey } from '@/server/auth/api-keys';
import { newId } from '@/lib/id';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import {
  HTTP_METHODS,
  isReference,
  type HttpMethod,
  type JsonSchema,
  type OpenApiDocument,
} from '@/lib/openapi/types';
import { freshDb } from '../../../helpers/db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
} from '../../../helpers/factories';
import { invokeRoute, type InvokeResult } from '../../../helpers/http';
import { GOOD_PASSWORD, passwordFixture } from '../../../server/auth/trust-support';
import { trustTestState } from '../../../server/auth/trust-support';
import { makePng, toFile } from '../../../server/uploads/support';
import { problemsOf } from '../../../lib/openapi/validator';
import { withTempStorage } from './media/support';
import { APP_URL } from './auth/support';

// ---- Harness ----------------------------------------------------------------------------------

type Handler = (req: Request, nextCtx?: { params: Promise<never> }) => Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE' | 'HEAD', Handler>>;

const document: OpenApiDocument = buildOpenApiDocument(APP_URL);

/** Documented path -> the module that serves it. */
const MODULES: Record<string, RouteModule> = {
  '/generations': generations,
  '/generations/{id}': generation,
  '/generations/{id}/cancel': generationCancel,
  '/models': models,
  '/tools': tools,
  '/explore': explore,
  '/prompt/enhance': enhance,
  '/uploads': uploads,
  '/media/{assetId}': media,
  '/account': account,
  '/account/password': accountPassword,
  '/account/ledger': accountLedger,
  '/account/export': accountExport,
  '/keys': keys,
  '/keys/{id}': keyById,
  '/auth/register': authRegister,
  '/auth/login': authLogin,
  '/auth/logout': authLogout,
  '/auth/logout-all': authLogoutAll,
  '/auth/me': authMe,
  '/auth/password/forgot': authForgot,
  '/auth/password/reset': authReset,
  '/auth/verify-email/request': verifyRequest,
  '/auth/verify-email/confirm': verifyConfirm,
  '/openapi.json': openapi,
};

const exercised = new Set<string>();

interface Call {
  headers?: Record<string, string>;
  /** Path parameters, substituted into the template. */
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Calls an operation and holds the result up to the document. */
interface Body {
  data?: unknown;
  nextCursor?: string | null;
  error?: { code: string; details?: unknown };
}

async function call(
  method: HttpMethod,
  path: string,
  options: Call = {},
  expected?: { status: number; authenticated?: boolean },
): Promise<InvokeResult<Body>> {
  const operation = document.paths[path]?.[method];
  expect(operation, `${method.toUpperCase()} ${path} is documented`).toBeDefined();
  const handler = MODULES[path]?.[method.toUpperCase() as 'GET'];
  expect(handler, `${method.toUpperCase()} ${path} has a route`).toBeDefined();

  const url = `/api/v1${path.replace(/\{(\w+)\}/g, (_, name: string) => options.params?.[name] ?? '')}`;
  const result = await invokeRoute<Body, never>(handler as Handler, {
    url,
    method: method.toUpperCase(),
    headers: options.headers,
    query: options.query,
    body: options.body,
    params: options.params as never,
  });

  exercised.add(`${method} ${path}`);
  const label = `${method.toUpperCase()} ${path} -> ${result.status}`;
  const response = operation?.responses[String(result.status)];
  expect(
    response,
    `${label} is a documented status (body: ${result.text.slice(0, 200)})`,
  ).toBeDefined();
  if (expected) expect(result.status, label).toBe(expected.status);
  if (!response || isReference(response)) return result;

  // Headers the document promises.
  for (const name of Object.keys(response.headers ?? {})) {
    if (name === 'X-Request-Id') expect(result.headers.get(name), `${label} ${name}`).toBeTruthy();
  }
  // The body.
  const types = Object.keys(response.content ?? {});
  if (result.status === 204 || result.status === 304) {
    expect(result.text, label).toBe('');
  } else if (types.includes('application/json') && result.text !== '') {
    expect(result.headers.get('content-type'), label).toMatch(/^application\/json/);
    const schema = response.content?.['application/json']?.schema as JsonSchema;
    expect(problemsOf(schema, result.json, document), label).toEqual([]);
  }
  // The documented budget is the one the route spent (signed-in callers only: anonymous ones
  // without a trusted proxy share a larger bucket).
  const budgets = operation?.['x-rate-limit'];
  const limitHeader = result.headers.get('x-ratelimit-limit');
  if (expected?.authenticated && budgets?.length === 1 && limitHeader !== null) {
    expect(Number(limitHeader), `${label}: X-RateLimit-Limit`).toBe(budgets[0]?.limit);
  }
  return result;
}

// ---- Fixtures ---------------------------------------------------------------------------------

const harness = freshDb();
const disk = withTempStorage();
const fixture = passwordFixture();
trustTestState();

async function person(overrides: Parameters<typeof createUser>[1] = {}) {
  const user = createUser(harness.db, overrides);
  const session = createSession(harness.db, user.id);
  const { key } = await createApiKey(user.id, 'conformance');
  return {
    user,
    browser: session.headers,
    cookie: session.cookie,
    bearer: { authorization: `Bearer ${key}` },
  };
}

const CREATE = {
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'A lighthouse at dawn',
};

// ---- Scenarios --------------------------------------------------------------------------------

describe('catalog and public feed', () => {
  it('lists models and tools, with or without credentials', async () => {
    const dev = await person();
    const models = await call(
      'get',
      '/models',
      { headers: dev.bearer },
      { status: 200, authenticated: true },
    );
    expect((models.json.data as Array<{ id: string }>).map((m) => m.id)).toContain(
      'aivore-demo-image',
    );
    await call('get', '/models', {}, { status: 200 });
    await call('get', '/tools', { headers: dev.bearer }, { status: 200, authenticated: true });
    const feed = await call('get', '/explore', {}, { status: 200 });
    expect(feed.json.nextCursor).toBeNull();
    await call('get', '/explore', { query: { limit: 500 } }, { status: 422 });
  });

  it('serves the document itself', async () => {
    const result = await call('get', '/openapi.json', {}, { status: 200 });
    expect((result.json as unknown as OpenApiDocument).openapi).toBe('3.1.0');
  });

  it('improves a prompt, and refuses an empty one', async () => {
    const dev = await person();
    const ok = await call(
      'post',
      '/prompt/enhance',
      { headers: dev.bearer, body: { prompt: 'a lighthouse at dawn', kind: 'image' } },
      { status: 200, authenticated: true },
    );
    expect(ok.json.data).toMatchObject({ engine: 'heuristic', translated: false });
    await call(
      'post',
      '/prompt/enhance',
      { headers: dev.bearer, body: { prompt: '   ', kind: 'image' } },
      { status: 422 },
    );
    await call(
      'post',
      '/prompt/enhance',
      { body: { prompt: 'x', kind: 'image' } },
      { status: 401 },
    );
  });
});

describe('generations', () => {
  it('creates, replays, reads, lists, updates, cancels and deletes', async () => {
    const dev = await person();
    const idempotency = { ...dev.bearer, 'idempotency-key': 'conformance-1' };

    const created = await call(
      'post',
      '/generations',
      { headers: idempotency, body: CREATE },
      { status: 201, authenticated: true },
    );
    const id = (created.json.data as { id: string }).id;
    expect(created.headers.get('location')).toBe(`/api/v1/generations/${id}`);
    const replay = await call(
      'post',
      '/generations',
      { headers: idempotency, body: CREATE },
      { status: 200 },
    );
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    await call(
      'post',
      '/generations',
      { headers: idempotency, body: { ...CREATE, prompt: 'Another' } },
      { status: 409 },
    );

    await call(
      'get',
      '/generations/{id}',
      { headers: dev.bearer, params: { id } },
      { status: 200, authenticated: true },
    );
    const page = await call(
      'get',
      '/generations',
      { headers: dev.bearer, query: { status: 'queued', kind: 'image', limit: 5 } },
      { status: 200, authenticated: true },
    );
    expect((page.json.data as unknown[]).length).toBe(1);
    await call(
      'get',
      '/generations',
      { headers: dev.bearer, query: { ids: id, favorite: 'false', q: 'lighthouse' } },
      { status: 200 },
    );
    await call(
      'get',
      '/generations',
      { headers: dev.bearer, query: { ids: 'nope' } },
      { status: 422 },
    );

    const patched = await call(
      'patch',
      '/generations/{id}',
      { headers: dev.bearer, params: { id }, body: { isPublic: true } },
      { status: 200, authenticated: true },
    );
    expect(patched.json.data).toMatchObject({ isPublic: true });
    await call(
      'patch',
      '/generations/{id}',
      { headers: dev.bearer, params: { id }, body: {} },
      { status: 422 },
    );

    const canceled = await call(
      'post',
      '/generations/{id}/cancel',
      { headers: dev.bearer, params: { id } },
      { status: 200, authenticated: true },
    );
    expect(canceled.json.data).toMatchObject({ status: 'canceled' });

    const finished = createGeneration(harness.db, { userId: dev.user.id, status: 'succeeded' });
    await call(
      'post',
      '/generations/{id}/cancel',
      { headers: dev.bearer, params: { id: finished.id } },
      { status: 409 },
    );

    await call(
      'delete',
      '/generations/{id}',
      { headers: dev.bearer, params: { id } },
      { status: 204, authenticated: true },
    );
    await call(
      'get',
      '/generations/{id}',
      { headers: dev.bearer, params: { id } },
      { status: 404 },
    );
    await call(
      'delete',
      '/generations/{id}',
      { headers: dev.bearer, params: { id: newId('gen') } },
      { status: 404 },
    );
  });

  it('refuses what the document says it refuses', async () => {
    const dev = await person();
    const broke = await person({ creditBalance: 0 });
    await call('post', '/generations', { body: CREATE }, { status: 401 });
    const refused = await call(
      'post',
      '/generations',
      { headers: broke.bearer, body: CREATE },
      { status: 402 },
    );
    expect(refused.json.error?.details).toMatchObject({ required: 1, balance: 0 });
    const invalid = await call(
      'post',
      '/generations',
      { headers: dev.bearer, body: { ...CREATE, params: { count: 99 } } },
      { status: 422 },
    );
    expect(invalid.json.error?.details).toMatchObject({
      issues: [expect.objectContaining({ path: 'params.count' })],
    });
    await call(
      'post',
      '/generations',
      {
        headers: dev.bearer,
        body: {
          tool: 'image-to-image',
          modelId: 'aivore-demo-image',
          prompt: 'x',
          inputAssetId: newId('ast'),
        },
      },
      { status: 404 },
    );
    await call('get', '/generations', {}, { status: 401 });
  });

  it('starts from an uploaded image', async () => {
    const dev = await person();
    const asset = createAsset(harness.db, { userId: dev.user.id, role: 'input', kind: 'image' });
    await call(
      'post',
      '/generations',
      {
        headers: dev.bearer,
        body: {
          tool: 'image-to-image',
          modelId: 'aivore-demo-image',
          prompt: 'warmer light',
          inputAssetId: asset.id,
        },
      },
      { status: 201 },
    );
  });
});

describe('uploads and media', () => {
  it('uploads an image and serves it back', async () => {
    const dev = await person();
    const form = new FormData();
    form.append('file', toFile(await makePng(40, 30)));
    const uploaded = await call(
      'post',
      '/uploads',
      { headers: dev.bearer, body: form },
      { status: 201, authenticated: true },
    );
    const asset = uploaded.json.data as { id: string; url: string; thumbUrl: string };
    expect(asset.url).toBe(`/api/v1/media/${asset.id}`);

    const file = await call(
      'get',
      '/media/{assetId}',
      { headers: dev.bearer, params: { assetId: asset.id } },
      { status: 200 },
    );
    expect(file.headers.get('content-type')).toMatch(/^image\//);
    const etag = file.headers.get('etag') ?? '';
    await call(
      'get',
      '/media/{assetId}',
      { headers: { ...dev.bearer, 'if-none-match': etag }, params: { assetId: asset.id } },
      { status: 304 },
    );
    await call(
      'get',
      '/media/{assetId}',
      { headers: { ...dev.bearer, range: 'bytes=0-9' }, params: { assetId: asset.id } },
      { status: 206 },
    );
    await call(
      'get',
      '/media/{assetId}',
      { headers: { ...dev.bearer, range: 'bytes=999999-' }, params: { assetId: asset.id } },
      { status: 416 },
    );
    await call(
      'get',
      '/media/{assetId}',
      {
        headers: dev.bearer,
        params: { assetId: asset.id },
        query: { variant: 'thumb', download: '1' },
      },
      { status: 200 },
    );
    await call(
      'get',
      '/media/{assetId}',
      { headers: dev.bearer, params: { assetId: asset.id }, query: { variant: 'huge' } },
      { status: 422 },
    );
    await call('get', '/media/{assetId}', { params: { assetId: asset.id } }, { status: 404 });
    const head = await call(
      'head',
      '/media/{assetId}',
      { headers: dev.bearer, params: { assetId: asset.id } },
      { status: 200 },
    );
    expect(head.text).toBe('');
  });

  it('refuses what is not an image upload', async () => {
    const dev = await person();
    await call('post', '/uploads', { body: new FormData() }, { status: 401 });
    await call('post', '/uploads', { headers: dev.bearer, body: new FormData() }, { status: 422 });
    await call(
      'post',
      '/uploads',
      { headers: dev.bearer, body: { not: 'multipart' } },
      { status: 415 },
    );
    const text = new FormData();
    text.append('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
    await call('post', '/uploads', { headers: dev.bearer, body: text }, { status: 415 });
    await call(
      'get',
      '/media/{assetId}',
      { headers: dev.bearer, params: { assetId: newId('ast') } },
      { status: 404 },
    );
    expect(disk.directory).toBeTruthy();
  });
});

describe('account', () => {
  it('reads and updates the profile, with an API key or a browser', async () => {
    const dev = await person();
    const me = await call(
      'get',
      '/account',
      { headers: dev.bearer },
      { status: 200, authenticated: true },
    );
    expect(me.json.data).toMatchObject({ id: dev.user.id, creditBalance: 50 });
    const updated = await call(
      'patch',
      '/account',
      { headers: dev.browser, body: { name: 'Layla', locale: 'en' } },
      { status: 200, authenticated: true },
    );
    expect(updated.json.data).toMatchObject({ name: 'Layla', locale: 'en' });
    expect(updated.headers.get('set-cookie')).toContain('aivore_locale=en');
    await call(
      'patch',
      '/account',
      { headers: dev.bearer, body: { name: '   ' } },
      { status: 422 },
    );
    await call('patch', '/account', { headers: dev.bearer, body: {} }, { status: 422 });
    await call('get', '/account', {}, { status: 401 });
  });

  it('shows the credit history page by page', async () => {
    const dev = await person();
    await call('post', '/generations', { headers: dev.bearer, body: CREATE }, { status: 201 });
    const first = await call(
      'get',
      '/account/ledger',
      { headers: dev.bearer, query: { limit: 1 } },
      { status: 200, authenticated: true },
    );
    expect(first.json.data).toHaveLength(1);
    await call(
      'get',
      '/account/ledger',
      { headers: dev.bearer, query: { limit: 0 } },
      { status: 422 },
    );
  });

  it('exports the data, three times a day', async () => {
    const dev = await person();
    const first = await call(
      'get',
      '/account/export',
      { headers: dev.browser },
      { status: 200, authenticated: true },
    );
    expect(first.headers.get('content-disposition')).toContain('attachment');
    expect(first.json).toBeDefined();
    // The refused call spends a try as well: the budget is checked before the handler runs.
    await call('get', '/account/export', { headers: dev.bearer }, { status: 403 });
    await call('get', '/account/export', { headers: dev.browser }, { status: 200 });
    const blocked = await call('get', '/account/export', { headers: dev.browser }, { status: 429 });
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect(blocked.json.error?.code).toBe('rate_limited');
  });

  it('changes the password for a browser session only', async () => {
    const dev = await person({ passwordHash: fixture.hash });
    await call(
      'post',
      '/account/password',
      {
        headers: dev.bearer,
        body: { currentPassword: GOOD_PASSWORD, newPassword: 'another fine passphrase 7' },
      },
      { status: 403 },
    );
    const wrong = await call(
      'post',
      '/account/password',
      {
        headers: dev.browser,
        body: { currentPassword: 'not it at all 12', newPassword: 'another fine passphrase 7' },
      },
      { status: 422 },
    );
    expect(wrong.json.error?.details).toMatchObject({ issues: [{ path: 'currentPassword' }] });
    await call(
      'post',
      '/account/password',
      {
        headers: dev.browser,
        body: { currentPassword: GOOD_PASSWORD, newPassword: 'another fine passphrase 7' },
      },
      { status: 204, authenticated: true },
    );
    await call('post', '/account/password', {}, { status: 401 });
  });

  it('deletes the account after the password is confirmed', async () => {
    const dev = await person({ passwordHash: fixture.hash });
    await call(
      'delete',
      '/account',
      { headers: dev.bearer, body: { password: GOOD_PASSWORD } },
      { status: 403 },
    );
    await call(
      'delete',
      '/account',
      { headers: dev.browser, body: { password: 'wrong wrong wrong 1' } },
      { status: 422 },
    );
    const gone = await call(
      'delete',
      '/account',
      { headers: dev.browser, body: { password: GOOD_PASSWORD } },
      { status: 204, authenticated: true },
    );
    expect(gone.headers.get('set-cookie')).toContain('aivore_session=;');
    await call('delete', '/account', {}, { status: 401 });
  });
});

describe('api keys', () => {
  it('creates, lists and revokes keys for a browser session only', async () => {
    const dev = await person();
    const created = await call(
      'post',
      '/keys',
      { headers: dev.browser, body: { name: 'CI' } },
      { status: 201, authenticated: true },
    );
    const { key, record } = created.json.data as {
      key: string;
      record: { id: string; prefix: string };
    };
    expect(key.startsWith(record.prefix)).toBe(true);

    const list = await call(
      'get',
      '/keys',
      { headers: dev.browser },
      { status: 200, authenticated: true },
    );
    expect(JSON.stringify(list.json)).not.toContain(key);
    await call('get', '/keys', { headers: dev.bearer }, { status: 403 });
    await call('post', '/keys', { headers: dev.bearer, body: { name: 'nope' } }, { status: 403 });
    await call('post', '/keys', { headers: dev.browser, body: { name: '' } }, { status: 422 });
    await call('post', '/keys', { body: { name: 'x' } }, { status: 401 });

    await call(
      'delete',
      '/keys/{id}',
      { headers: dev.browser, params: { id: record.id } },
      { status: 204, authenticated: true },
    );
    await call(
      'delete',
      '/keys/{id}',
      { headers: dev.browser, params: { id: newId('key') } },
      { status: 404 },
    );
    await call(
      'delete',
      '/keys/{id}',
      { headers: dev.bearer, params: { id: record.id } },
      { status: 403 },
    );
  });

  it('stops at the documented number of active keys', async () => {
    const dev = await person();
    // `person` made one; fill the rest through the service so the route budget is not spent.
    for (let index = 0; index < 19; index += 1) await createApiKey(dev.user.id, `key ${index}`);
    await call(
      'post',
      '/keys',
      { headers: dev.browser, body: { name: 'one too many' } },
      { status: 409 },
    );
  });
});

describe('sessions and sign-in', () => {
  it('registers, signs in, asks who is signed in and signs out', async () => {
    const origin = { origin: APP_URL };
    const registered = await call(
      'post',
      '/auth/register',
      {
        headers: origin,
        body: { email: 'new@example.com', password: GOOD_PASSWORD, name: 'Layla', locale: 'ar' },
      },
      { status: 201 },
    );
    expect(registered.json.data).toMatchObject({
      email: 'new@example.com',
      locale: 'ar',
      creditBalance: 50,
    });
    const cookie =
      registered.headers
        .getSetCookie()
        .find((c) => c.startsWith('aivore_session='))
        ?.split(';')[0] ?? '';
    expect(cookie).not.toBe('');

    await call(
      'post',
      '/auth/register',
      {
        headers: origin,
        body: { email: 'new@example.com', password: GOOD_PASSWORD, name: 'Again' },
      },
      { status: 409 },
    );
    await call(
      'post',
      '/auth/register',
      { headers: origin, body: { email: 'weak@example.com', password: 'password', name: 'Weak' } },
      { status: 422 },
    );
    await call(
      'post',
      '/auth/register',
      { body: { email: 'x@example.com', password: GOOD_PASSWORD, name: 'No origin' } },
      { status: 403 },
    );

    const login = await call(
      'post',
      '/auth/login',
      { headers: origin, body: { email: 'new@example.com', password: GOOD_PASSWORD } },
      { status: 200 },
    );
    const session =
      login.headers
        .getSetCookie()
        .find((c) => c.startsWith('aivore_session='))
        ?.split(';')[0] ?? '';
    await call(
      'post',
      '/auth/login',
      { headers: origin, body: { email: 'new@example.com', password: 'wrong wrong wrong 1' } },
      { status: 401 },
    );

    const signedIn = await call(
      'get',
      '/auth/me',
      { headers: { cookie: session } },
      { status: 200 },
    );
    expect(signedIn.json.data).toMatchObject({ email: 'new@example.com' });
    const visitor = await call('get', '/auth/me', {}, { status: 200 });
    expect(visitor.json.data).toBeNull();

    await call(
      'post',
      '/auth/logout',
      { headers: { ...origin, cookie: session } },
      { status: 204 },
    );
    const again = await call(
      'post',
      '/auth/login',
      { headers: origin, body: { email: 'new@example.com', password: GOOD_PASSWORD } },
      { status: 200 },
    );
    const second =
      again.headers
        .getSetCookie()
        .find((c) => c.startsWith('aivore_session='))
        ?.split(';')[0] ?? '';
    await call(
      'post',
      '/auth/logout-all',
      { headers: { ...origin, cookie: second } },
      { status: 204, authenticated: true },
    );
    await call('post', '/auth/logout-all', {}, { status: 401 });
  });

  it('answers the recovery and confirmation flows as documented', async () => {
    const dev = await person();
    const origin = { origin: APP_URL };
    await call(
      'post',
      '/auth/password/forgot',
      { headers: origin, body: { email: 'nobody@example.com' } },
      { status: 202 },
    );
    await call(
      'post',
      '/auth/password/forgot',
      { headers: origin, body: { email: 'not an email' } },
      { status: 422 },
    );
    const bad = await call(
      'post',
      '/auth/password/reset',
      { headers: origin, body: { token: 'x'.repeat(43), password: GOOD_PASSWORD } },
      { status: 400 },
    );
    expect(bad.json.error?.details).toMatchObject({ reason: 'invalid' });
    const unconfirmed = await call(
      'post',
      '/auth/verify-email/confirm',
      { body: { token: 'y'.repeat(43) } },
      { status: 400 },
    );
    expect(unconfirmed.json.error?.details).toMatchObject({ reason: 'invalid' });
    const sent = await call(
      'post',
      '/auth/verify-email/request',
      { headers: dev.bearer },
      { status: 202 },
    );
    expect(sent.json.data).toEqual({ sent: true, verified: false, resendAfterSec: 60 });
    const tooSoon = await call(
      'post',
      '/auth/verify-email/request',
      { headers: dev.bearer },
      { status: 429 },
    );
    expect(tooSoon.json.error?.details).toMatchObject({ retryAfterSec: expect.any(Number) });
    const confirmed = await person({ emailVerifiedAt: Date.now() });
    const already = await call(
      'post',
      '/auth/verify-email/request',
      { headers: confirmed.bearer },
      { status: 200 },
    );
    expect(already.json.data).toEqual({ sent: false, verified: true, resendAfterSec: 0 });
  });
});

// ---- Completeness -----------------------------------------------------------------------------

describe('the scenarios above', () => {
  it('exercise every operation of the document', () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        if (item[method] && !exercised.has(`${method} ${path}`)) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
