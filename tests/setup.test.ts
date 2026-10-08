import 'server-only';
import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('isolates tests from real data and paid providers', () => {
    expect(process.env.DATABASE_PATH).toBe(':memory:');
    expect(process.env.WORKER_MODE).toBe('off');
    expect(process.env.ENABLE_MOCK_PROVIDER).toBe('true');
    expect(process.env.STORAGE_LOCAL_DIR).toContain('aivore-vitest-media');
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.SESSION_SECRET?.length).toBeGreaterThanOrEqual(32);
  });

  it('stubs server-only and resolves the @ alias', async () => {
    const headers = await import('@/server/security/headers');
    expect(headers.securityHeaders).toBeTypeOf('function');
  });
});
