// OWNER: providers-mock — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { GenerationProvider } from '../types';

/** The Demo provider: placeholder images and a "motion preview" GIF, no API key, no network. */
export const mockProvider: GenerationProvider = {
  id: 'mock',
  isConfigured: (env) => env.ENABLE_MOCK_PROVIDER,
  async submit() {
    throw new NotImplementedError('providers.mock.submit');
  },
  async poll() {
    throw new NotImplementedError('providers.mock.poll');
  },
};
