import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { ASSET_ROLES, GENERATION_STATUSES, LEDGER_REASONS, USER_ROLES } from '@/lib/api-types';
import { KINDS, PROVIDER_IDS, TOOLS, type GenerationParams } from '@/lib/catalog/types';
import { LOCALES } from '@/lib/i18n/locales';
import {
  BILLING_GATEWAY_IDS,
  LIVE_SUBSCRIPTION_STATUSES,
  ORDER_KINDS,
  ORDER_STATUSES,
  SUBSCRIPTION_STATUSES,
} from '@/lib/billing/types';
import { BILLING_EMAIL_KINDS } from '@/server/email/types';

/**
 * Database schema (docs/ARCHITECTURE.md section 4). Ids are text primary keys from `newId`;
 * timestamps are integer milliseconds since the epoch. After changing this file run
 * `npm run db:generate` and commit the new SQL in `drizzle/`.
 */

/** `column IN ('a', 'b')` built from a constant list, so TS unions and SQL CHECKs cannot drift. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => sql.raw(`'${value.replace(/'/g, "''")}'`));
  return sql`${column} in (${sql.join(literals, sql`, `)})`;
}

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    locale: text('locale', { enum: LOCALES }).notNull().default('ar'),
    /** Cached balance; the ledger is the audit trail. Never negative. */
    creditBalance: integer('credit_balance').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    disabledAt: integer('disabled_at'),
    /** When the address was confirmed (emailed link, password reset or operator). Null: unconfirmed. */
    emailVerifiedAt: integer('email_verified_at'),
    /**
     * `email` without the aliases a mailbox may have (dots and +tags of Gmail-style providers),
     * unique, so one mailbox cannot farm sign-up bonuses. `email` keeps what the user typed. Null
     * only for rows that predate the column.
     */
    emailCanonical: text('email_canonical'),
    /** Client address at registration, for the daily sign-up cap. Cleared when the account is deleted. */
    signupIp: text('signup_ip'),
    /** Set once the account was deleted: the row stays as an anonymized tombstone for accounting. */
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('users_email_canonical_uq').on(t.emailCanonical),
    index('users_signup_ip_idx').on(t.signupIp, t.createdAt),
    check('users_credit_balance_nonnegative', sql`${t.creditBalance} >= 0`),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_role_valid', oneOf(t.role, USER_ROLES)),
    check('users_locale_valid', oneOf(t.locale, LOCALES)),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie token (+ pepper); the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Display prefix such as `avk_ab12cd34`. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

export const creditLedger = sqliteTable(
  'credit_ledger',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason', { enum: LEDGER_REASONS }).notNull(),
    /** Deliberately not a foreign key: ledger rows outlive the generation they refer to. */
    generationId: text('generation_id'),
    note: text('note'),
    /** Globally unique when set (NULLs do not collide), which makes grants and refunds replayable. */
    idempotencyKey: text('idempotency_key'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('credit_ledger_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('credit_ledger_generation_idx').on(t.generationId),
    uniqueIndex('credit_ledger_idempotency_uq').on(t.idempotencyKey),
    check('credit_ledger_delta_nonzero', sql`${t.delta} <> 0`),
    check('credit_ledger_balance_nonnegative', sql`${t.balanceAfter} >= 0`),
    check('credit_ledger_reason_valid', oneOf(t.reason, LEDGER_REASONS)),
  ],
);

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tool: text('tool', { enum: TOOLS }).notNull(),
    kind: text('kind', { enum: KINDS }).notNull(),
    modelId: text('model_id').notNull(),
    provider: text('provider', { enum: PROVIDER_IDS }).notNull(),
    status: text('status', { enum: GENERATION_STATUSES }).notNull().default('queued'),
    prompt: text('prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    params: text('params', { mode: 'json' }).$type<GenerationParams>().notNull(),
    inputAssetId: text('input_asset_id').references((): AnySQLiteColumn => assets.id, {
      onDelete: 'set null',
    }),
    cost: integer('cost').notNull(),
    progress: integer('progress').notNull().default(0),
    providerJobId: text('provider_job_id'),
    providerMeta: text('provider_meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    /**
     * Set (compare-and-set) right BEFORE `provider.submit` is called and cleared by the same
     * statement that stores the provider job id. While it is set and `providerJobId` is null, a
     * submit may have reached the provider without us learning its id (a crash in between): the
     * outcome is indeterminate, and re-submitting a PAID provider would bill the same request
     * twice, so the engine fails such a job with a refund instead (`interrupted`).
     */
    submitStartedAt: integer('submit_started_at'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    workerId: text('worker_id'),
    leaseUntil: integer('lease_until'),
    idempotencyKey: text('idempotency_key'),
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('generations_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('generations_status_lease_idx').on(t.status, t.leaseUntil),
    index('generations_public_created_idx').on(t.isPublic, sql`${t.createdAt} desc`),
    // From the first version of the daily upstream budget, which summed this table; the budget now
    // reads `upstream_spend`. Kept (a drop is not an additive change); any scan by age can use it.
    index('generations_created_idx').on(t.createdAt),
    uniqueIndex('generations_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    check('generations_status_valid', oneOf(t.status, GENERATION_STATUSES)),
    check('generations_tool_valid', oneOf(t.tool, TOOLS)),
    check('generations_kind_valid', oneOf(t.kind, KINDS)),
    check('generations_provider_valid', oneOf(t.provider, PROVIDER_IDS)),
    check('generations_progress_range', sql`${t.progress} between 0 and 100`),
    check('generations_cost_nonnegative', sql`${t.cost} >= 0`),
    check('generations_attempts_nonnegative', sql`${t.attempts} >= 0`),
  ],
);

/**
 * What the platform owes its PAID providers, one row per paid generation, written in the same
 * transaction that debits the user and inserts the generation. It is the ledger of the daily
 * upstream budget (`DAILY_UPSTREAM_BUDGET_CREDITS`) and deliberately has no foreign key: deleting
 * a generation or the whole account must not return the money the provider already billed, so the
 * row outlives both. `releasedAt` is set when the generation is refunded in full (failed or
 * canceled: the provider is not paid for it, or at least not by the user). It holds no user id and
 * no content, so nothing personal outlives an account; rows older than the budget window are
 * deleted as new ones are written.
 */
export const upstreamSpend = sqliteTable(
  'upstream_spend',
  {
    generationId: text('generation_id').primaryKey(),
    provider: text('provider', { enum: PROVIDER_IDS }).notNull(),
    cost: integer('cost').notNull(),
    createdAt: integer('created_at').notNull(),
    releasedAt: integer('released_at'),
  },
  (t) => [
    index('upstream_spend_created_idx').on(t.createdAt),
    check('upstream_spend_provider_valid', oneOf(t.provider, PROVIDER_IDS)),
    check('upstream_spend_cost_nonnegative', sql`${t.cost} >= 0`),
  ],
);

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    generationId: text('generation_id').references(() => generations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ASSET_ROLES }).notNull(),
    kind: text('kind', { enum: KINDS }).notNull(),
    /** Position among a generation's outputs. */
    index: integer('output_index').notNull().default(0),
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key'),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sha256: text('sha256'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('assets_generation_idx').on(t.generationId, t.index),
    index('assets_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    check('assets_role_valid', oneOf(t.role, ASSET_ROLES)),
    check('assets_kind_valid', oneOf(t.kind, KINDS)),
    check('assets_bytes_nonnegative', sql`${t.bytes} >= 0`),
    check('assets_index_nonnegative', sql`${t.index} >= 0`),
  ],
);

export const EMAIL_TOKEN_TYPES = ['verify', 'reset'] as const;
export type EmailTokenType = (typeof EMAIL_TOKEN_TYPES)[number];

/**
 * Single-use links sent by email (address confirmation, password reset). Only the keyed hash of
 * the secret is stored; `usedAt` is set by a compare-and-set when the link is used or revoked.
 */
export const emailTokens = sqliteTable(
  'email_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: EMAIL_TOKEN_TYPES }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('email_tokens_user_type_idx').on(t.userId, t.type, t.createdAt),
    check('email_tokens_type_valid', oneOf(t.type, EMAIL_TOKEN_TYPES)),
  ],
);

/**
 * One row per mailbox that ever received the free sign-up bonus, keyed by a keyed hash of its
 * canonical address (not the address). It outlives account deletion, so deleting and registering
 * again cannot claim the bonus twice.
 */
export const signupBonusClaims = sqliteTable('signup_bonus_claims', {
  keyHash: text('key_hash').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

// ---- Billing (docs/ARCHITECTURE.md "Billing (as built)") -----------------------------------------
// Financial records must outlive everything else, so none of these tables cascades from `users`:
// a user row that still has orders cannot be hard-deleted (accounts are anonymized, not removed).

/**
 * A monthly plan the user pays for. At most one per user is "live" (incomplete, active or
 * past_due), which the partial unique index enforces whatever the code does.
 */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** A plan id from `lib/billing/plans.ts` (config, so not an SQL enum). */
    planId: text('plan_id').notNull(),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
    /** Day of the month (UTC) the first period started, so month ends do not drift (31st -> 28th -> 28th). */
    anchorDay: integer('anchor_day'),
    currentPeriodStart: integer('current_period_start'),
    currentPeriodEnd: integer('current_period_end'),
    /** Set by the user: the subscription ends when the paid period does, no renewal is issued. */
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .notNull()
      .default(false),
    /**
     * When the scheduler has to look at this subscription next (issue the renewal link, mark it
     * past due, expire it, finish a cancellation). A claimed row carries a short lease here so
     * several processes never work on the same subscription.
     */
    nextChargeAt: integer('next_charge_at'),
    canceledAt: integer('canceled_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('subscriptions_one_live_per_user_uq')
      .on(t.userId)
      .where(
        sql`${t.status} in (${sql.join(
          LIVE_SUBSCRIPTION_STATUSES.map((status) => sql.raw(`'${status}'`)),
          sql`, `,
        )})`,
      ),
    index('subscriptions_due_idx').on(t.status, t.nextChargeAt),
    index('subscriptions_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    check('subscriptions_status_valid', oneOf(t.status, SUBSCRIPTION_STATUSES)),
    check(
      'subscriptions_anchor_day_valid',
      sql`${t.anchorDay} is null or ${t.anchorDay} between 1 and 31`,
    ),
    check(
      'subscriptions_period_when_running',
      sql`${t.status} not in ('active', 'past_due') or (${t.currentPeriodStart} is not null and ${t.currentPeriodEnd} is not null and ${t.anchorDay} is not null)`,
    ),
  ],
);

/**
 * One purchase attempt: a credit pack, a subscription's first month or one of its renewals. The
 * amount, VAT, currency and credits are copied from the server-side price list when the order is
 * created and are the only numbers a payment is ever compared with. `paid_at` is set in the same
 * transaction that grants the credits, so `paid_at is not null` means "the credits were granted".
 */
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ORDER_KINDS }).notNull(),
    /** Pack id or plan id at the time of purchase. */
    itemId: text('item_id').notNull(),
    amountHalalas: integer('amount_halalas').notNull(),
    currency: text('currency').notNull(),
    /** VAT contained in `amount_halalas`. */
    vatHalalas: integer('vat_halalas').notNull(),
    credits: integer('credits').notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending'),
    gateway: text('gateway', { enum: BILLING_GATEWAY_IDS }).notNull(),
    /** The gateway's hosted payment page (Moyasar invoice) behind `checkout_url`. */
    gatewayInvoiceId: text('gateway_invoice_id'),
    gatewayPaymentId: text('gateway_payment_id'),
    /** Where the buyer pays. Only shown to the owner of the order, only while it can still be paid. */
    checkoutUrl: text('checkout_url'),
    subscriptionId: text('subscription_id').references(() => subscriptions.id),
    /** Buyer-supplied `Idempotency-Key`; a retry of the same checkout returns the same order. */
    idempotencyKey: text('idempotency_key'),
    /** The checkout cannot be paid after this. */
    expiresAt: integer('expires_at'),
    /** The subscription period this order paid for (subscription orders, once paid). */
    periodStart: integer('period_start'),
    periodEnd: integer('period_end'),
    refundedHalalas: integer('refunded_halalas').notNull().default(0),
    /** Credits taken back for refunds so far; never more than `credits`. */
    clawedBackCredits: integer('clawed_back_credits').notNull().default(0),
    /** When the gateway was last asked about this order (reconciliation claim). */
    lastCheckedAt: integer('last_checked_at'),
    createdAt: integer('created_at').notNull(),
    paidAt: integer('paid_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('orders_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    uniqueIndex('orders_gateway_invoice_uq').on(t.gateway, t.gatewayInvoiceId),
    uniqueIndex('orders_gateway_payment_uq').on(t.gateway, t.gatewayPaymentId),
    uniqueIndex('orders_one_pending_renewal_uq')
      .on(t.subscriptionId)
      .where(sql`${t.kind} = 'subscription_renewal' and ${t.status} = 'pending'`),
    index('orders_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('orders_status_checked_idx').on(t.status, t.lastCheckedAt),
    index('orders_subscription_idx').on(t.subscriptionId),
    check('orders_kind_valid', oneOf(t.kind, ORDER_KINDS)),
    check('orders_status_valid', oneOf(t.status, ORDER_STATUSES)),
    check('orders_gateway_valid', oneOf(t.gateway, BILLING_GATEWAY_IDS)),
    check('orders_currency_sar', sql`${t.currency} = 'SAR'`),
    check('orders_amount_positive', sql`${t.amountHalalas} > 0`),
    check('orders_vat_within_amount', sql`${t.vatHalalas} between 0 and ${t.amountHalalas}`),
    check('orders_credits_positive', sql`${t.credits} > 0`),
    check(
      'orders_refund_within_amount',
      sql`${t.refundedHalalas} between 0 and ${t.amountHalalas}`,
    ),
    check('orders_clawback_within_credits', sql`${t.clawedBackCredits} between 0 and ${t.credits}`),
  ],
);

/**
 * Webhook deliveries we received, for idempotency (`event_key` is unique) and for the audit
 * trail. The body is never stored: only a hash of it without the shared secret.
 */
export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    gateway: text('gateway', { enum: BILLING_GATEWAY_IDS }).notNull(),
    /** `<gateway>:<event id>`; a redelivery of the same event has the same key. */
    eventKey: text('event_key').notNull(),
    orderId: text('order_id').references(() => orders.id),
    type: text('type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    receivedAt: integer('received_at').notNull(),
    /** Null until the event was fully handled; an unprocessed event is handled again on redelivery. */
    processedAt: integer('processed_at'),
  },
  (t) => [
    uniqueIndex('billing_events_event_key_uq').on(t.eventKey),
    index('billing_events_order_idx').on(t.orderId),
    check('billing_events_gateway_valid', oneOf(t.gateway, BILLING_GATEWAY_IDS)),
  ],
);

/**
 * The dedupe record of the mails billing sends about a change of state (receipt, renewal link,
 * refund, ...). A row is inserted in the SAME transaction that makes the change, keyed by what the
 * change is (`receipt:<orderId>`, `refund:<orderId>:<refunded total>`, ...), so a replayed webhook,
 * a restarted scheduler or a second process finds the change already made and records nothing.
 * `sent_at` is claimed by a compare-and-set before the message is queued, so at most one process
 * ever sends a given row; a row whose process died between the commit and the claim is picked up
 * by the next scheduler tick. No foreign key and no address: the row names a user id and the facts
 * of one payment, nothing that identifies a person once the account is anonymized.
 */
export const emailEvents = sqliteTable(
  'email_events',
  {
    key: text('key').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind', { enum: BILLING_EMAIL_KINDS }).notNull(),
    /** The order or subscription the mail is about (`ord_...` / `sub_...`). */
    subject: text('subject').notNull(),
    /** JSON: the facts the message states, frozen when the change was made. */
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
    /** Null until a process claimed the delivery. */
    sentAt: integer('sent_at'),
  },
  (t) => [
    index('email_events_unsent_idx')
      .on(t.createdAt)
      .where(sql`${t.sentAt} is null`),
    index('email_events_subject_idx').on(t.subject, t.kind),
    check('email_events_kind_valid', oneOf(t.kind, BILLING_EMAIL_KINDS)),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;
export type LedgerEntry = typeof creditLedger.$inferSelect;
export type NewLedgerEntry = typeof creditLedger.$inferInsert;
export type GenerationRow = typeof generations.$inferSelect;
export type NewGenerationRow = typeof generations.$inferInsert;
export type UpstreamSpendRow = typeof upstreamSpend.$inferSelect;
export type EmailTokenRow = typeof emailTokens.$inferSelect;
export type NewEmailTokenRow = typeof emailTokens.$inferInsert;
export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
export type BillingEventRow = typeof billingEvents.$inferSelect;
export type NewBillingEventRow = typeof billingEvents.$inferInsert;
export type EmailEventRow = typeof emailEvents.$inferSelect;
