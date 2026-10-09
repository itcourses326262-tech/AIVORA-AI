/**
 * The wire contract between the API and its clients (the web UI and third-party developers).
 * Everything here is JSON-serializable; timestamps are integer milliseconds since the epoch.
 */
import type { GenerationParams, Kind, ModelSpec, ProviderId, Tool } from '@/lib/catalog/types';
import type {
  BillingCurrency,
  BillingMode,
  OrderKind,
  OrderStatus,
  PurchaseType,
  SubscriptionStatus,
} from '@/lib/billing/types';
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
  /** The sign-in address was confirmed (emailed link, password reset or an operator). */
  emailVerified: boolean;
  /**
   * The server asks for a confirmed address before this account may generate or buy credits
   * (`EMAIL_VERIFICATION`): while it is true and `emailVerified` is false, `POST /generations` and
   * `POST /billing/checkout` answer 403 `email_not_verified` and the balance is 0 until the
   * sign-up bonus is paid on confirmation.
   */
  emailVerificationRequired: boolean;
  /** Free credits confirming the address would add now; 0 when none (already granted, claimed by another account of the mailbox, or no confirmation needed). */
  pendingBonusCredits: number;
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

/** Body of `GET /api/health` (not enveloped). `status` is `error`, with HTTP 503, when the database is unreachable. */
export interface HealthDTO {
  status: 'ok' | 'error';
  db: boolean;
  worker: 'inline' | 'external' | 'off';
  version: string;
}

// ---- Billing (`/api/v1/billing/*`, docs/ARCHITECTURE.md "Billing (as built)") ------------------
// Amounts are integer halalas (1 SAR = 100 halalas) and include VAT.

export interface LocalizedTextDTO {
  en: string;
  ar: string;
}

export interface BillingPackDTO {
  id: string;
  credits: number;
  priceHalalas: number;
  /** VAT contained in the price. */
  vatHalalas: number;
  name: LocalizedTextDTO;
  description: LocalizedTextDTO;
  popular: boolean;
}

export interface BillingPlanDTO {
  id: string;
  /** Credits granted for every paid month. */
  monthlyCredits: number;
  /** Price of one month. */
  priceHalalas: number;
  vatHalalas: number;
  name: LocalizedTextDTO;
  description: LocalizedTextDTO;
  popular: boolean;
}

/** `GET /billing/plans` (public). */
export interface BillingCatalogDTO {
  currency: BillingCurrency;
  vatPercent: number;
  /** `off`: nothing can be bought right now; `mock`: development fake checkout. */
  gateway: BillingMode;
  /** False when `gateway` is `off`. */
  canPurchase: boolean;
  packs: BillingPackDTO[];
  plans: BillingPlanDTO[];
  /** How a subscription renews: a payment link is issued `leadDays` before the period ends and can be paid for `graceDays` after. */
  renewal: { leadDays: number; graceDays: number };
}

/** Body of `POST /billing/checkout` (plus the `Idempotency-Key` header). The server decides the price. */
export interface CheckoutRequest {
  type: PurchaseType;
  id: string;
}

export interface OrderDTO {
  id: string;
  kind: OrderKind;
  /** Pack id or plan id. */
  itemId: string;
  amountHalalas: number;
  vatHalalas: number;
  currency: BillingCurrency;
  credits: number;
  status: OrderStatus;
  createdAt: number;
  paidAt?: number;
  /** The checkout cannot be paid after this. */
  expiresAt?: number;
  /** Present only while `status` is `pending`: send the buyer here to pay. */
  checkoutUrl?: string;
  refundedHalalas: number;
  /**
   * Credits taken back from the balance for refunds so far. After a refund that found the credits
   * already spent this is less than the share the refund is worth; `credits - clawedBackCredits`
   * is what the order still holds.
   */
  clawedBackCredits: number;
  subscriptionId?: string;
  /** The subscription month this order paid for. */
  periodStart?: number;
  periodEnd?: number;
}

export interface SubscriptionDTO {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  /** The subscription ends when the paid period does. */
  cancelAtPeriodEnd: boolean;
  canceledAt?: number;
  createdAt: number;
  /** The unpaid first-month or renewal order, with its `checkoutUrl`, while there is one. */
  pendingOrder?: OrderDTO;
}
