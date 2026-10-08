// OWNER: provider-openai — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { GenerationProvider } from '../types';

export const openaiProvider: GenerationProvider = {
  id: 'openai',
  // Stays false until the adapter exists, so no model is ever offered through it.
  isConfigured: () => false,
  async submit() {
    throw new NotImplementedError('providers.openai.submit');
  },
  async poll() {
    throw new NotImplementedError('providers.openai.poll');
  },
};
