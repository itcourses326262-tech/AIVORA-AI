import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTools, type ToolSpec } from '@/lib/tools';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { invokeRoute } from '../../../../helpers/http';

import { GET as getModels } from '@/app/api/v1/models/route';
import { GET } from '@/app/api/v1/tools/route';

beforeEach(() => setRateLimiter(new InMemoryRateLimiter()));
afterEach(() => setRateLimiter(null));

describe('GET /api/v1/tools', () => {
  it('lists the four tools of the registry, anonymously', async () => {
    const { status, json } = await invokeRoute<{ data: ToolSpec[] }>(GET, {
      url: '/api/v1/tools',
    });
    expect(status).toBe(200);
    expect(json.data).toEqual(getTools());
    expect(json.data.map((tool) => tool.id)).toEqual([
      'text-to-image',
      'image-to-image',
      'text-to-video',
      'image-to-video',
    ]);
    expect(json.data.filter((tool) => tool.needsInputImage).map((tool) => tool.id)).toEqual([
      'image-to-image',
      'image-to-video',
    ]);
  });

  it('may be cached by shared caches for a few minutes, since it is the same for everyone', async () => {
    const { headers } = await invokeRoute(GET, { url: '/api/v1/tools' });
    expect(headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
  });

  it('shares the named catalog rate limit with /models, apart from the general bucket', async () => {
    const models = await invokeRoute(getModels, { url: '/api/v1/models' });
    const tools = await invokeRoute(GET, { url: '/api/v1/tools' });
    expect(models.headers.get('x-ratelimit-limit')).toBe('240');
    expect(tools.headers.get('x-ratelimit-limit')).toBe('240');
    expect(models.headers.get('x-ratelimit-remaining')).toBe('239');
    expect(tools.headers.get('x-ratelimit-remaining')).toBe('238');
  });

  it('throttles with 429 once the budget is spent', async () => {
    for (let i = 0; i < 240; i += 1) await invokeRoute(GET, { url: '/api/v1/tools' });
    const blocked = await invokeRoute<{ error: { code: string } }>(GET, { url: '/api/v1/tools' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
  });
});
