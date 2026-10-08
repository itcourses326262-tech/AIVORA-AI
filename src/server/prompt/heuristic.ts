// OWNER: catalog — replace this stub
import 'server-only';
import type { EnhancePromptRequest, EnhancePromptResponse } from '@/lib/api-types';
import { NotImplementedError } from '@/lib/errors';

/**
 * The no-key, no-network enhancer: appends tasteful descriptors suited to the kind (image or
 * video) and never changes the user's own words. Always `engine: 'heuristic'`, `translated: false`.
 */
export function enhanceHeuristically(_input: EnhancePromptRequest): EnhancePromptResponse {
  throw new NotImplementedError('prompt.enhanceHeuristically');
}
