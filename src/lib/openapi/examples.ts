/**
 * Example values of the document. Each one is typed with the DTO it illustrates (so a changed DTO
 * fails the type check here) and `tests/lib/openapi` validates all of them against the schemas.
 */
import type {
  ApiKeyDTO,
  AssetDTO,
  CreateApiKeyResponse,
  EnhancePromptResponse,
  GenerationDTO,
  LedgerEntryDTO,
  ModelDTO,
  UserDTO,
} from '@/lib/api-types';
import { mockModels } from '@/lib/catalog/models/mock';
import { getTools } from '@/lib/tools';

export const IDS = {
  user: 'usr_01k8m3x9q2v7c5n4h6j0t1r8wd',
  generation: 'gen_01k8m3x9q2v7c5n4h6j0t1r8we',
  generationVideo: 'gen_01k8m3y1b4z7a0d2f5g8k9m3qs',
  generationFailed: 'gen_01k8m3z6c1d4e7f0h2j5n8p3tv',
  asset: 'ast_01k8m3x9q2v7c5n4h6j0t1r8wf',
  assetInput: 'ast_01k8m3w5a2b8c1d4e7f0h3j6kn',
  key: 'key_01k8m3v2h5j8k1m4n7p0q3r6st',
  ledger: 'led_01k8m3x9q2v7c5n4h6j0t1r8wg',
} as const;

/** What a developer would see in a terminal; never a real key. */
export const EXAMPLE_API_KEY = 'avk_ab12cd34_Qm9sZDNyQ3VydGlzV2h5SXRSb2FyZWRfX1hZWg';
export const EXAMPLE_KEY_PREFIX = 'avk_ab12cd34';

const T0 = 1_760_000_000_000;

export const userExample: UserDTO = {
  id: IDS.user,
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'ar',
  creditBalance: 49,
  createdAt: T0 - 86_400_000,
  emailVerified: true,
  emailVerificationRequired: true,
  pendingBonusCredits: 0,
  hasPassword: true,
};

export const assetExample: AssetDTO = {
  id: IDS.asset,
  kind: 'image',
  mimeType: 'image/webp',
  width: 1024,
  height: 1024,
  bytes: 184_320,
  url: `/api/v1/media/${IDS.asset}`,
  thumbUrl: `/api/v1/media/${IDS.asset}?variant=thumb`,
};

export const inputAssetExample: AssetDTO = {
  id: IDS.assetInput,
  kind: 'image',
  mimeType: 'image/webp',
  width: 1536,
  height: 1024,
  bytes: 232_448,
  url: `/api/v1/media/${IDS.assetInput}`,
  thumbUrl: `/api/v1/media/${IDS.assetInput}?variant=thumb`,
};

export const generationQueuedExample: GenerationDTO = {
  id: IDS.generation,
  tool: 'text-to-image',
  kind: 'image',
  modelId: 'aivore-demo-image',
  prompt: 'A lighthouse at dawn, soft fog, cinematic',
  params: { aspectRatio: '16:9', count: 1 },
  status: 'queued',
  progress: 0,
  cost: 1,
  outputs: [],
  isPublic: false,
  isFavorite: false,
  createdAt: T0,
};

export const generationProcessingExample: GenerationDTO = {
  ...generationQueuedExample,
  status: 'processing',
  progress: 55,
  startedAt: T0 + 400,
};

export const generationSucceededExample: GenerationDTO = {
  ...generationQueuedExample,
  status: 'succeeded',
  progress: 100,
  outputs: [assetExample],
  startedAt: T0 + 400,
  finishedAt: T0 + 3_600,
};

export const generationCanceledExample: GenerationDTO = {
  ...generationQueuedExample,
  status: 'canceled',
  progress: 0,
  finishedAt: T0 + 2_000,
};

export const generationFailedExample: GenerationDTO = {
  id: IDS.generationFailed,
  tool: 'image-to-video',
  kind: 'video',
  modelId: 'aivore-demo-video',
  prompt: 'Slow push-in, golden hour',
  params: { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p' },
  status: 'failed',
  progress: 10,
  cost: 6,
  error: { code: 'unavailable', message: 'The generation service is temporarily unavailable.' },
  outputs: [],
  input: inputAssetExample,
  isPublic: false,
  isFavorite: false,
  createdAt: T0 - 60_000,
  startedAt: T0 - 59_000,
  finishedAt: T0 - 40_000,
};

function modelExample(index: number): ModelDTO {
  const spec = mockModels[index];
  if (!spec) throw new Error(`The mock catalog has no model at ${index}`);
  const { providerModel: _providerModel, ...rest } = spec;
  return { ...rest, available: true };
}

export const imageModelExample: ModelDTO = modelExample(0);
export const videoModelExample: ModelDTO = modelExample(1);

export const toolsExample = getTools();

export const ledgerExample: LedgerEntryDTO[] = [
  {
    id: IDS.ledger,
    delta: -1,
    balanceAfter: 49,
    reason: 'generation',
    generationId: IDS.generation,
    createdAt: T0,
  },
  {
    id: 'led_01k8m3t7e0f3g6h9j2k5m8n1pq',
    delta: 50,
    balanceAfter: 50,
    reason: 'signup_bonus',
    createdAt: T0 - 86_400_000,
  },
];

export const apiKeyExample: ApiKeyDTO = {
  id: IDS.key,
  name: 'Production server',
  prefix: EXAMPLE_KEY_PREFIX,
  createdAt: T0 - 3 * 86_400_000,
  lastUsedAt: T0 - 120_000,
};

export const createdApiKeyExample: CreateApiKeyResponse = {
  key: EXAMPLE_API_KEY,
  record: {
    id: IDS.key,
    name: 'Production server',
    prefix: EXAMPLE_KEY_PREFIX,
    createdAt: T0,
  },
};

export const enhancedPromptExample: EnhancePromptResponse = {
  prompt:
    'A lighthouse on a rocky coast at dawn, soft volumetric fog, warm rim light, cinematic wide composition, highly detailed',
  engine: 'heuristic',
  translated: false,
};
