import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelDTO } from '@/lib/api-types';
import { resetEnvForTests } from '@/server/env';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { invokeRoute } from '../../../../helpers/http';

import { GET } from '@/app/api/v1/models/route';

beforeEach(() => {
  vi.stubEnv('FAL_KEY', 'test-key-never-sent-anywhere');
  resetEnvForTests();
  setRateLimiter(new InMemoryRateLimiter());
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  setRateLimiter(null);
});

describe('GET /api/v1/models: limits.followsInputAspect', () => {
  it('tells the studio which models keep the input proportions, so it can hide the ratio control', async () => {
    const { json } = await invokeRoute<{ data: ModelDTO[] }>(GET, { url: '/api/v1/models' });
    const flagged = json.data
      .filter((model) => model.limits.followsInputAspect === true)
      .map((model) => model.id)
      .sort();
    expect(flagged).toEqual([
      'fal-flux-dev-img2img',
      'fal-nano-banana-pro-edit',
      'fal-wan-2-6-i2v',
    ]);

    const others = json.data.filter((model) => !flagged.includes(model.id));
    expect(others.length).toBeGreaterThan(0);
    for (const model of others) expect(model.limits.followsInputAspect, model.id).toBeFalsy();
  });
});
