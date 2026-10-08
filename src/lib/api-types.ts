/**
 * The wire contract between the API and its clients (the web UI and third-party developers).
 * Everything here is JSON-serializable; timestamps are integer milliseconds since the epoch.
 */
import type { GenerationParams, Kind, ModelSpec, ProviderId, Tool } from '@/lib/catalog/types';
import type { AnyErrorCode } from '@/lib/errors';
import type { Locale } from '@/lib/i18n/locales';

export type { GenerationParams, Kind, ModelSpec, ProviderId, Tool };

// ---- Enumerations (also used by the database schema) ----------------------------------------

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const GENERATION_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'canceled',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Terminal states are final: no further transition ever happens. */
export function isTerminalStatus(status: GenerationStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

export const LEDGER_REASONS = [
  'signup_bonus',
  'generation',
  'refund',
  'admin_grant',
  'purchase',
  'adjustment',
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const ASSET_ROLES = ['input', 'output'] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

// ---- Envelope -------------------------------------------------------------------------------

/** Success: `{ data }`. Lists use {@link Page}. */
export interface ApiSuccess<T> {
  data: T;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: {
    /** Machine-readable; the UI maps it to localized text through `errors.<code>`. */
    code: AnyErrorCode;
    /** English, for developers and logs. */
    message: string;
    details?: unknown;
  };
}

/** One problem found while validating a request; `details` of a `validation_failed` error. */
export interface ValidationIssue {
  /** Dotted path into the request, e.g. `params.count`; empty for the whole body. */
  path: string;
  message: string;
}
export interface ValidationDetails {
  issues: ValidationIssue[];
}

// ---- Resources ------------------------------------------------------------------------------

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  locale: Locale;
  creditBalance: number;
  createdAt: number;
}

export interface AssetDTO {
  id: string;
  kind: Kind;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bytes: number;
  /** `/api/v1/media/:id` */
  url: string;
  /** `/api/v1/media/:id?variant=thumb` */
  thumbUrl?: string;
}

export interface GenerationDTO {
  id: string;
  tool: Tool;
  kind: Kind;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  params: GenerationParams;
  status: GenerationStatus;
  /** 0-100 */
  progress: number;
  cost: number;
  error?: { code: string; message: string };
  outputs: AssetDTO[];
  input?: AssetDTO;
  isPublic: boolean;
  isFavorite: boolean;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Only present on public feeds. */
  owner?: { name: string };
}

export interface ModelDTO extends Omit<ModelSpec, 'provider' | 'providerModel'> {
  provider: ProviderId;
  /** False when the provider is not configured (missing API key). */
  available: boolean;
  unavailableReason?: 'not_configured';
}

export interface LedgerEntryDTO {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
  generationId?: string;
  note?: string;
  createdAt: number;
}

export interface ApiKeyDTO {
  id: string;
  name: string;
  /** Display prefix such as `avk_ab12cd34`; the secret is shown once at creation. */
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

// ---- Requests -------------------------------------------------------------------------------

export interface CreateGenerationRequest {
  tool: Tool;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  params?: Partial<GenerationParams>;
  inputAssetId?: string;
  isPublic?: boolean;
}

export interface UpdateGenerationRequest {
  isPublic?: boolean;
  isFavorite?: boolean;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  locale?: Locale;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UpdateAccountRequest {
  name?: string;
  locale?: Locale;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateApiKeyRequest {
  name: string;
}

export interface CreateApiKeyResponse {
  /** The full key, `avk_<prefix>_<secret>`. Returned exactly once. */
  key: string;
  record: ApiKeyDTO;
}

export interface EnhancePromptRequest {
  prompt: string;
  kind: Kind;
  locale?: Locale;
}

export interface EnhancePromptResponse {
  prompt: string;
  engine: 'openai' | 'anthropic' | 'heuristic';
  translated: boolean;
}

/** Query of `GET /generations`. */
export interface ListGenerationsQuery {
  kind?: Kind;
  status?: GenerationStatus;
  favorite?: boolean;
  q?: string;
  /** Batch polling: `ids=a,b,c`. */
  ids?: string[];
  limit?: number;
  cursor?: string;
}

export interface HealthDTO {
  status: 'ok';
  db: boolean;
  worker: 'inline' | 'external' | 'off';
  version: string;
}
