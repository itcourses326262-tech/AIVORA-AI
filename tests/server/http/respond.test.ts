import { describe, expect, it } from 'vitest';
import { accepted, created, json, noContent, ok, page } from '@/server/http/respond';

describe('response helpers', () => {
  it('ok wraps data in the envelope with a JSON content type', async () => {
    const response = ok({ id: 'gen_1' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ data: { id: 'gen_1' } });
  });

  it('ok keeps init options such as headers', async () => {
    const response = ok([1, 2], { headers: { 'X-Custom': 'yes' } });
    expect(response.headers.get('x-custom')).toBe('yes');
    expect(await response.json()).toEqual({ data: [1, 2] });
  });

  it('created is 201 and accepted is 202, regardless of init.status', async () => {
    expect(created({ a: 1 }, { status: 200 }).status).toBe(201);
    const response = accepted({ queued: true });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { queued: true } });
  });

  it('page returns rows with the cursor, including a null cursor', async () => {
    expect(await page([1, 2, 3], 'abc').json()).toEqual({ data: [1, 2, 3], nextCursor: 'abc' });
    expect(await page([], null).json()).toEqual({ data: [], nextCursor: null });
  });

  it('noContent is an empty 204', async () => {
    const response = noContent();
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('json serializes any body as is', async () => {
    const response = json({ error: { code: 'x' } }, { status: 418 });
    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ error: { code: 'x' } });
  });
});
