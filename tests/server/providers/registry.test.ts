import { afterEach, describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from '@/lib/catalog/types';
import { parseEnv } from '@/server/env';
import {
  getProvider,
  isProviderAvailable,
  listProviders,
  setProviderOverrides,
} from '@/server/providers/registry';
import { fakeProvider } from '../../helpers/fakes';

afterEach(() => setProviderOverrides(null));

const env = (extra: Record<string, string> = {}) =>
  parseEnv({ SESSION_SECRET: 's'.repeat(40), ...extra });

describe('registry', () => {
  it('resolves one provider per id, with the matching id', () => {
    for (const id of PROVIDER_IDS) expect(getProvider(id).id).toBe(id);
    expect(listProviders().map((provider) => provider.id)).toEqual([...PROVIDER_IDS]);
  });

  it('follows ENABLE_MOCK_PROVIDER for the Demo provider', () => {
    expect(isProviderAvailable('mock', env({ ENABLE_MOCK_PROVIDER: 'true' }))).toBe(true);
    expect(isProviderAvailable('mock', env({ ENABLE_MOCK_PROVIDER: 'false' }))).toBe(false);
  });

  it('offers no real provider before its adapter exists, even with keys set', () => {
    const keyed = env({ OPENAI_API_KEY: 'k', FAL_KEY: 'k', REPLICATE_API_TOKEN: 'k' });
    for (const id of ['openai', 'fal', 'replicate'] as const) {
      expect(isProviderAvailable(id, keyed)).toBe(false);
    }
  });

  it('lets tests inject fakes and restore the built-ins', () => {
    const builtIn = getProvider('mock');
    const fake = fakeProvider();
    setProviderOverrides({ mock: fake });
    expect(getProvider('mock')).toBe(fake);
    expect(getProvider('fal')).not.toBe(fake);
    expect(isProviderAvailable('mock', env({ ENABLE_MOCK_PROVIDER: 'false' }))).toBe(true);
    expect(fake.isConfigured).toHaveBeenCalledOnce();

    setProviderOverrides(null);
    expect(getProvider('mock')).toBe(builtIn);
  });

  it('replaces the whole override set on each call', () => {
    const first = fakeProvider({ id: 'mock' });
    const second = fakeProvider({ id: 'fal' });
    setProviderOverrides({ mock: first });
    setProviderOverrides({ fal: second });
    expect(getProvider('fal')).toBe(second);
    expect(getProvider('mock')).not.toBe(first);
  });
});
