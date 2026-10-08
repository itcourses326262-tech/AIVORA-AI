// OWNER: provider-fal — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { GenerationProvider } from '../types';

export const falProvider: GenerationProvider = {
  id: 'fal',
  // Stays false until the adapter exists, so no model is ever offered through it.
  isConfigured: () => false,
  async submit() {
    throw new NotImplementedError('providers.fal.submit');
  },
  async poll() {
    throw new NotImplementedError('providers.fal.poll');
  },
};
