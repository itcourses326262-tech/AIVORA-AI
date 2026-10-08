import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { falProvider } from '@/server/providers/fal';
import type { PollResult, ProviderContext, ProviderInput } from '@/server/providers/types';
import { falHarness, inputFor, jsonResponse, pngImage, QUEUE } from './fixtures';

/**
 * A tiny stand-in for queue.fal.run and its CDN that behaves like the real queue: a request is
 * IN_QUEUE once, IN_PROGRESS once, then COMPLETED, and its result is served from the response URL.
 */
function fakeFalQueue(image: Uint8Array) {
  const seen: string[] = [];
  let polls = 0;
  const handler = async (url: string, init: RequestInit) => {
    seen.push(`${init.method ?? 'GET'} ${url}`);
    if (url === `${QUEUE}/fal-ai/flux/schnell`) {
      return jsonResponse({
        request_id: 'life_1',
        status_url: `${QUEUE}/fal-ai/flux/requests/life_1/status`,
        response_url: `${QUEUE}/fal-ai/flux/requests/life_1`,
        cancel_url: `${QUEUE}/fal-ai/flux/requests/life_1/cancel`,
      });
    }
    if (url.endsWith('/requests/life_1/status')) {
      polls += 1;
      const status = polls === 1 ? 'IN_QUEUE' : polls === 2 ? 'IN_PROGRESS' : 'COMPLETED';
      return jsonResponse({ status, request_id: 'life_1' });
    }
    if (url.endsWith('/requests/life_1')) {
      return jsonResponse({
        images: [{ url: 'https://v3.fal.media/files/life.png', content_type: 'image/png' }],
        seed: 7,
        has_nsfw_concepts: [false],
      });
    }
    if (url === 'https://v3.fal.media/files/life.png') {
      return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/png' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { handler, seen };
}

async function drive(input: ProviderInput, ctx: ProviderContext): Promise<PollResult[]> {
  const submitted = await falProvider.submit(input, ctx);
  if (submitted.mode !== 'async') throw new Error('expected an async job');
  const results: PollResult[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await falProvider.poll(submitted.providerJobId, input, ctx, submitted.meta);
    results.push(result);
    if (result.status === 'succeeded' || result.status === 'failed') break;
  }
  return results;
}

describe('a whole generation against a fake queue', () => {
  it('goes IN_QUEUE, IN_PROGRESS, COMPLETED and yields an image that decodes', async () => {
    const png = await pngImage(96, 96);
    const queue = fakeFalQueue(png);
    const h = falHarness(queue.handler);
    const input = inputFor('fal-flux-schnell');

    const results = await drive(input, h.ctx);

    expect(results.map((result) => result.status)).toEqual(['pending', 'running', 'succeeded']);
    const done = results.at(-1);
    if (done?.status !== 'succeeded') throw new Error('expected success');
    expect(done.outputs).toHaveLength(1);
    expect(done.outputs[0]).toMatchObject({ kind: 'image', mimeType: 'image/png', seed: 7 });

    // What the engine does next: download the URL and check it is a real image.
    const response = await h.ctx.fetch(done.outputs[0]?.url as string);
    const meta = await sharp(new Uint8Array(await response.arrayBuffer())).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(96);

    expect(queue.seen).toEqual([
      `POST ${QUEUE}/fal-ai/flux/schnell`,
      `GET ${QUEUE}/fal-ai/flux/requests/life_1/status`,
      `GET ${QUEUE}/fal-ai/flux/requests/life_1/status`,
      `GET ${QUEUE}/fal-ai/flux/requests/life_1/status`,
      `GET ${QUEUE}/fal-ai/flux/requests/life_1`,
      'GET https://v3.fal.media/files/life.png',
    ]);
  });

  it('can be canceled with the URL that submit stored', async () => {
    const queue = fakeFalQueue(await pngImage(8, 8));
    const h = falHarness((url, init) =>
      init.method === 'PUT'
        ? jsonResponse({ status: 'CANCELLATION_REQUESTED' }, { status: 202 })
        : queue.handler(url, init),
    );
    const input = inputFor('fal-flux-schnell');
    const submitted = await falProvider.submit(input, h.ctx);
    if (submitted.mode !== 'async') throw new Error('expected an async job');
    await falProvider.cancel?.(submitted.providerJobId, h.ctx, submitted.meta);
    expect(queue.seen).toEqual([`POST ${QUEUE}/fal-ai/flux/schnell`]);
    expect(h.call(1)).toMatchObject({
      method: 'PUT',
      url: `${QUEUE}/fal-ai/flux/requests/life_1/cancel`,
    });
  });
});
