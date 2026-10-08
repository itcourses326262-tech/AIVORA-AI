# AIVORE — Architecture & Module Contracts

> Source of truth for everyone building AIVORE. If the code and this document disagree, fix the
> document in the same change. Pre-1.0: contracts may evolve, but **additively** and always announced
> in the agent's final report (`contractChanges`).

## 1. Product

AIVORE is a bilingual (Arabic RTL / English LTR) AI creative platform. v0.1 scope is **AI image and
video generation as a service**:

| Tool id           | Kind  | Needs input image | Description                          |
| ----------------- | ----- | ----------------- | ------------------------------------ |
| `text-to-image`   | image | no                | Prompt → 1–4 images                  |
| `image-to-image`  | image | yes               | Edit / restyle an uploaded image     |
| `text-to-video`   | video | no                | Prompt → short video clip            |
| `image-to-video`  | video | yes               | Animate an uploaded image            |

Plus: prompt enhancer (LLM-assisted when a key exists, heuristic otherwise), credits, gallery,
public share/explore, REST API with API keys, web studio. The platform is **extensible by data**:
adding a model = one `ModelSpec` entry; adding a provider = one adapter; adding a tool = one
`ToolSpec` + (usually) no UI rewrite.

First-run promise: `npm install && npm run dev` → register → 50 free credits → generate with the
**Demo (mock) provider** with zero API keys → results appear in seconds. Real providers are opt-in
via env keys.

## 2. Stack & global conventions

- **Next.js 16 (App Router)**, React 19, **TypeScript 5.9 strict** (do NOT use TS 7), Tailwind CSS v4,
  Node ≥ 22, npm. Verify any Next API against the *installed* version (async `params`/`cookies()`/
  `headers()`; `middleware` is `proxy` in v16; no `next lint`).
- **SQLite** via `better-sqlite3` + **Drizzle ORM**. better-sqlite3 is **synchronous**: transactions
  callbacks must be sync (no `await` inside). WAL mode, `busy_timeout` 5000, foreign keys ON.
- Passwords: `node:crypto` scrypt (no bcrypt). Tokens: random 32 bytes, stored as SHA-256 (+pepper).
- Images: `sharp`. Mock video: `gifenc` animated GIF (honest "motion preview", `image/gif`).
- Validation: `zod` (v4). Icons: `lucide-react`. Class merge: `clsx` + `tailwind-merge`.
- Fonts: self-hosted via `@fontsource-variable/*` (NO Google Fonts network fetch at build time).
- Tests: Vitest (+ jsdom, Testing Library for components), Playwright for E2E (chromium is
  pre-installed at `/opt/pw-browsers`; never run `playwright install`).
- Path alias `@/*` → `src/*`. ES modules everywhere. No default exports except Next-required ones.
- Server-only code lives in `src/server/**` and starts with `import 'server-only'` (aliased to a
  no-op in Vitest). `src/lib/**` is isomorphic (safe for client bundles: no node APIs, no secrets).
- No top-level side effects in modules (no DB open, no env parse at import) — `next build` imports
  every route module.
- IDs: `newId('gen')` → `gen_<26 char sortable base32>` (ULID in **lowercase** Crockford base32, so ids are valid inside
  storage keys; strictly increasing within a process). Prefixes: `usr ses key gen ast led`.
- Timestamps: integer **milliseconds since epoch** everywhere (DB, DTOs, JSON).
- Style: small files, named exports, early returns, no `any` (use `unknown` + narrowing),
  comments only for non-obvious *why*. Prettier + ESLint clean (`docs/ARCHITECTURE.md` itself is in `.prettierignore`: it is hand-edited by every agent).

### Environment (parsed lazily by `getEnv()` in `src/server/env.ts`, zod, documented in `.env.example`)

```
APP_URL=http://localhost:3000
DATABASE_PATH=./data/aivore.db            # ":memory:" allowed in tests
SESSION_SECRET=                            # pepper for token hashing; REQUIRED (>=32 chars) when NODE_ENV=production; dev default allowed with a warning
STORAGE_DRIVER=local                       # local | s3
STORAGE_LOCAL_DIR=./data/media
S3_ENDPOINT= S3_REGION=auto S3_BUCKET= S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY= S3_FORCE_PATH_STYLE=false S3_SIGNED_URL_TTL_SEC=900
ENABLE_MOCK_PROVIDER=true                  # Demo models; set false in production once real keys exist
OPENAI_API_KEY= FAL_KEY= REPLICATE_API_TOKEN= ANTHROPIC_API_KEY=
PROMPT_ENHANCER=auto                       # auto | openai | anthropic | heuristic
PROMPT_ENHANCER_OPENAI_MODEL=gpt-4.1-mini  PROMPT_ENHANCER_ANTHROPIC_MODEL=claude-haiku-5-5
SIGNUP_ENABLED=true  SIGNUP_BONUS_CREDITS=50  ADMIN_EMAILS=            # comma list → role=admin at registration
WORKER_MODE=inline                         # inline (in the Next process) | external (scripts/worker.ts) | off
WORKER_CONCURRENCY=2  MAX_ACTIVE_PER_USER=4  MAX_ATTEMPTS=3
GENERATION_TIMEOUT_SEC_IMAGE=180  GENERATION_TIMEOUT_SEC_VIDEO=900
MAX_UPLOAD_MB=10
MODERATION_BLOCKLIST=                      # extra comma-separated terms (in addition to built-ins)
MODERATION_PROVIDER=none                   # none | openai
LOG_LEVEL=info                             # debug | info | warn | error | silent
TRUST_PROXY=false                          # honour X-Forwarded-For for the client IP (only behind a proxy you control, which must APPEND to it). Without it every client is the address "unknown": signed-in users are still limited per account, anonymous callers share one larger budget per route (§6.1, §16); production logs a warning once when forwarding headers arrive anyway
TRUSTED_PROXY_HOPS=1                       # with TRUST_PROXY: trusted proxies in front of the app; the client is the X-Forwarded-For entry that many hops from the RIGHT
RATE_LIMIT_DISABLED=false                  # DANGER: switches every rate limit off, for e2e/load tests only (loud warning at start-up)
DAILY_UPSTREAM_BUDGET_CREDITS=0            # cost protection: most credits that may be committed to PAID (non-Demo) generations per rolling 24 h across all users; over it POST /generations is 503 service_busy. 0 = off (§17)
```

## 3. Repository layout & ownership

```
package.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts
playwright.config.ts drizzle.config.ts .env.example .gitignore .dockerignore Dockerfile docker-compose.yml
.github/workflows/ci.yml          drizzle/ (generated SQL migrations)       public/ (logo, icons)
scripts/   worker.ts migrate.ts admin.ts           docs/   e2e/   tests/ (mirrors src/)
src/
  instrumentation.ts                       # starts inline worker (Node runtime only, singleton)
  app/
    layout.tsx globals.css                 # root: fonts, <html lang dir>, theme, providers
    (marketing)/page.tsx ...               # landing + marketing layout
    (auth)/login register ...              # centered auth layout
    (app)/studio gallery gallery/[id] account docs ...   # authed app shell (server-guarded)
    explore/ s/[id]/                       # public pages
    api/health/route.ts
    api/v1/**/route.ts                     # THE API (used by UI and by developers)
  components/ui/**  components/layout/**  components/studio/** components/gallery/** components/account/** components/marketing/**
  lib/                                     # isomorphic
    id.ts utils.ts errors.ts api-types.ts api-client.ts theme.ts theme-server.ts version.ts
    i18n/{index.ts,define.ts,locales.ts,server.ts,client.tsx,messages/*.ts}
    catalog/{types.ts,pricing.ts,aspect.ts,models/{mock,openai,fal,replicate}.ts,index.ts}
    tools/{index.ts}
    validation/{generation.ts,...}
  server/                                  # server-only
    env.ts logger.ts
    db/{schema.ts,index.ts,tx.ts,migrate.ts}
    http/{route.ts,errors.ts,respond.ts,request.ts}
    auth/{index.ts,password.ts,sessions.ts,api-keys.ts,cookies.ts,context.ts,users.ts,tokens.ts}
    security/{rate-limit.ts,origin.ts,ssrf.ts,ip.ts,ipaddr.ts,headers.ts}
    credits/index.ts
    moderation/index.ts
    prompt/{enhancer.ts,heuristic.ts}
    providers/{types.ts,errors.ts,registry.ts,http.ts,mock/**,openai/**,fal/**,replicate/**}
    storage/{types.ts,index.ts,local.ts,s3.ts}
    uploads/{index.ts,sniff.ts,image.ts}
    generations/{service.ts,lifecycle.ts,dto.ts,queries.ts,list.ts,idempotency.ts,budget.ts,paid.ts}
    jobs/{runner.ts,job-run.ts,input.ts,outputs.ts,backoff.ts,failure.ts,runtime.ts,wake.ts,worker.ts,start.ts}
```

### Ownership map (parallel agents edit ONLY files they own; everything else is read-only to them)

| Owner key           | Owns |
| ------------------- | ---- |
| `foundation`        | tooling/config, `lib/{id,utils,errors,api-types,api-client}`, `lib/i18n/**` runtime + empty namespace files, `lib/catalog/{types,pricing,aspect,index}.ts`, `server/{env,logger}`, `server/db/**`, `server/http/**`, `server/credits/**`, module **stubs**, `tests/helpers/**`, `app/layout.tsx` shell + `globals.css` baseline, `lib/{theme,theme-server,version}.ts`, `instrumentation.ts` wiring, `app/api/health`, the placeholder `app/(marketing)/page.tsx` (ui-kit replaces it) |
| `auth-security`     | `server/auth/**`, `server/security/**`, `app/api/v1/auth/**`, `app/api/v1/account/**`, `app/api/v1/keys/**`, `scripts/admin.ts`, tests for these |
| `catalog`           | `lib/catalog/models/mock.ts`(with providers-mock), `lib/tools/**`, `lib/validation/**`, `server/moderation/**`, `server/prompt/**`, `app/api/v1/{models,tools,prompt}/**` |
| `providers-mock`    | `server/providers/{types,errors,registry,http}.ts`, `server/providers/mock/**`, `lib/catalog/models/mock.ts` |
| `provider-fal`      | `server/providers/fal/**`, `lib/catalog/models/fal.ts` |
| `provider-replicate`| `server/providers/replicate/**`, `lib/catalog/models/replicate.ts` |
| `provider-openai`   | `server/providers/openai/**`, `lib/catalog/models/openai.ts` |
| `storage`           | `server/storage/**`, `server/uploads/**`, `app/api/v1/uploads/**`, `app/api/v1/media/**` |
| `engine`            | `server/generations/**`, `server/jobs/**`, `instrumentation.ts`, `scripts/worker.ts`, `app/api/v1/generations/**`, `app/api/v1/explore/**` |
| `ui-kit`            | `components/ui/**`, `components/layout/**`, `app/globals.css`, `lib/i18n/messages/{common,errors,auth,landing}.ts`, `(marketing)/**`, `(auth)/**`, `public/**` |
| `studio`            | `app/(app)/studio/**`, `components/studio/**`, `lib/i18n/messages/studio.ts` |
| `gallery`           | `app/(app)/gallery/**`, `app/explore/**`, `app/s/**`, `components/gallery/**`, `lib/i18n/messages/gallery.ts` |
| `account-docs`      | `app/(app)/account/**`, `app/(app)/docs/**`, `components/account/**`, `lib/i18n/messages/account.ts`, `public/openapi.json` generation script |
| `devops`            | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/**`, `README.md`, `docs/*.md` (except this file's sections owned by foundation) |
| `e2e`               | `e2e/**`, `playwright.config.ts` |
| `hardening`         | after the backend phase: `server/http/{route,request}.ts`, `server/security/**`, `server/generations/**`, `server/jobs/**`, additive `server/env.ts`, `server/db/schema.ts` + `drizzle/`, `lib/errors.ts` + `lib/i18n/messages/errors.ts`, the `followsInputAspect` flag of `lib/catalog/models/fal.ts`, `app/layout.tsx`, `lib/theme.ts`, `.env.example`, this file's consolidation (§17) |

**Rules for parallel agents**

1. Edit only files you own. Need a change elsewhere? Make a minimal **additive** change if it is a
   type/export addition, and list it in `contractChanges`; otherwise report it in `openIssues`.
2. **Never run `git add/commit/reset/checkout/stash`** — the orchestrator commits.
3. **Never run `npm install` bare.** Missing dependency? `flock /tmp/aivore-npm.lock npm install <pkg>`
   and report it. Never upgrade/remove existing deps.
4. Schema changes: only additive, via `src/server/db/schema.ts`, then
   `flock /tmp/aivore-db.lock npm run db:generate`. Report in `schemaChanges`.
5. Typecheck only your area: `npx tsc --noEmit 2>&1 | grep -E '<your path prefixes>'` (neighbours may be mid-edit).
   Test only yours: `npx vitest run <your test paths>`.
6. Dev servers / Playwright: use a unique port (`3100 + agent index`) and a unique
   `DATABASE_PATH`/`STORAGE_LOCAL_DIR` under your scratchpad. Kill what you start.
7. Replace stubs fully — no stub, `throw new NotImplementedError`, or `TODO` may remain in owned files.
8. Definition of Done: owned code typechecks, lint-clean, tests written **and passing**, behaviour
   verified (not just compiled), final report returned as structured output.

## 4. Data model (Drizzle, SQLite) — `src/server/db/schema.ts`

All `id` are text PKs from `newId`. All timestamps integer ms.

- `users`: `id, email (unique, lowercased), name, passwordHash, role ('user'|'admin'), locale ('ar'|'en'), creditBalance (int ≥ 0, cached; CHECK ≥ 0), createdAt, updatedAt, disabledAt?`
- `sessions`: `id, userId→users (cascade), tokenHash (unique), expiresAt, createdAt, lastSeenAt, userAgent?, ip?`
- `api_keys`: `id, userId→users (cascade), name, prefix (display, e.g. "avk_ab12cd34"), keyHash (unique), lastUsedAt?, revokedAt?, createdAt`
- `credit_ledger`: `id, userId, delta (int, ≠ 0), balanceAfter (int), reason ('signup_bonus'|'generation'|'refund'|'admin_grant'|'purchase'|'adjustment'), generationId?, note?, idempotencyKey? (unique when not null), createdAt`
- `generations`: `id, userId, tool, kind ('image'|'video'), modelId, provider, status ('queued'|'processing'|'succeeded'|'failed'|'canceled'), prompt, negativePrompt?, params (json: GenerationParams), inputAssetId?→assets, cost (int), progress (0–100), providerJobId?, providerMeta (json?), submitStartedAt?, errorCode?, errorMessage?, attempts (int), workerId?, leaseUntil?, idempotencyKey? (unique per user), isPublic (bool), isFavorite (bool), createdAt, updatedAt, startedAt?, finishedAt?`; indexes: `(userId, createdAt desc)`, `(status, leaseUntil)`, `(isPublic, createdAt desc)`, `(createdAt)` (the daily upstream budget sums the last 24 h), unique `(userId, idempotencyKey)`. `submitStartedAt` (ms) is the "submit started" marker of §6.6/§8: set in a compare-and-set right before `provider.submit`, cleared by the statement that stores `providerJobId` (and on completion, failure, cancellation and after a retryable submit error). While it is set and `providerJobId` is null, a paid provider may be holding a request we have no id for. `workerId` holds the per-claim identity `<runner id>/<n>`. `errorCode` is one of `invalid_input content_policy rate_limited unavailable timeout internal interrupted` (§5 Errors).
- `assets`: `id, userId, generationId?→generations (cascade), role ('input'|'output'), kind ('image'|'video'), index (int, output order), storageKey, thumbKey?, mimeType, bytes, width?, height?, durationMs?, sha256?, createdAt`
- Soft rule: deleting a generation deletes its output assets rows **and** storage objects (best-effort), keeps ledger rows (`generationId` set null via app code, not FK cascade).

Implementation notes (as built): table objects are `users, sessions, apiKeys, creditLedger, generations, assets`; row types
`UserRow, SessionRow, ApiKeyRow, LedgerEntry, GenerationRow, AssetRow` (+ `New…Row` for inserts), all exported from
`@/server/db/schema`. `assets.index` is stored in the column `output_index` (`index` is an SQL keyword). Every enum-like
column also has a `CHECK (… in (…))` generated from the same constant arrays as the TS unions, plus `progress between 0 and
100`, `cost/attempts/bytes >= 0`, `delta <> 0`, `balance_after >= 0` and `email = lower(email)`. Extra indexes beyond the
list above (FK lookups): `sessions(userId)`, `sessions(expiresAt)`, `api_keys(userId)`, `credit_ledger(generationId)`,
`assets(generationId, output_index)`, `assets(userId, createdAt desc)`. `credit_ledger.generation_id` is a plain column
(no FK) and `credit_ledger.idempotency_key` is globally unique (NULLs may repeat).

Migrations: `drizzle/` generated by drizzle-kit, applied automatically by `runMigrations(db)` on first
`getDb()` (idempotent; see §14). Pre-1.0 the orchestrator squashes migrations into one at phase boundaries.

## 5. Core types (isomorphic) — `src/lib/*`

```ts
// catalog/types.ts
type Tool = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video';
type Kind = 'image' | 'video';
type ProviderId = 'mock' | 'openai' | 'fal' | 'replicate';
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9';
type Resolution = '480p' | '720p' | '1080p';
interface ModelSpec {
  id: string;                       // stable public id e.g. "flux-schnell"
  provider: ProviderId;
  providerModel: string;            // upstream id e.g. "fal-ai/flux/schnell"
  kind: Kind;
  tools: Tool[];                    // which tools this model serves
  label: string;
  description: { en: string; ar: string };
  badges?: Array<'fast' | 'quality' | 'new' | 'demo' | 'audio'>;
  limits: {
    maxPromptChars: number;
    aspectRatios: AspectRatio[]; defaultAspectRatio: AspectRatio;
    maxCount: number; defaultCount: number;                    // images: 1–4, video: 1
    durations?: number[]; defaultDuration?: number;            // video, seconds
    resolutions?: Resolution[]; defaultResolution?: Resolution;
    supportsNegativePrompt: boolean; supportsSeed: boolean; supportsStrength: boolean;
    followsInputAspect?: boolean;   // the result keeps the input image's proportions (set on fal-nano-banana-pro-edit, fal-flux-dev-img2img, fal-wan-2-6-i2v): validation accepts an aspectRatio and ignores it, the UI hides the control
  };
  pricing:                                                      // credits (ints)
    | { type: 'image'; perImage: number }
    | { type: 'video'; perSecond: Partial<Record<Resolution, number>> };
}
interface GenerationParams {
  aspectRatio: AspectRatio; count: number; durationSec?: number; resolution?: Resolution;
  seed?: number; strength?: number;
}
// catalog/pricing.ts
computeCost(model: ModelSpec, params: GenerationParams): number   // pure, ceil, min 1
// catalog/index.ts
getModels(): ModelSpec[]            // aggregate of models/*.ts
getModel(id: string): ModelSpec | undefined
// tools/index.ts
interface ToolSpec { id: Tool; kind: Kind; needsInputImage: boolean; icon: string; i18nKey: string }
getTools(): ToolSpec[]; getTool(id: Tool): ToolSpec | undefined
```

Mock models (always listed when `ENABLE_MOCK_PROVIDER=true`, badge `demo`): `aivore-demo-image`
(tools: text-to-image, image-to-image; cost 1/img) and `aivore-demo-video` (tools: text-to-video,
image-to-video; 2/sec 480p, 3/sec 720p; durations 3/5). Real models are declared by provider owners
with **verified** upstream ids (see §9 provider verification rule).

Availability is a *server* concern: `GET /api/v1/models` returns each model with `available: boolean`
(provider configured). Unavailable models are shown disabled in the UI with a "needs API key" hint.

### DTOs — `src/lib/api-types.ts` (the wire contract; foundation writes, everyone imports)

```ts
interface UserDTO { id; email; name; role; locale: 'ar'|'en'; creditBalance: number; createdAt: number }
interface AssetDTO { id; kind: Kind; mimeType; width?: number; height?: number; durationMs?: number; bytes: number;
                     url: string /* /api/v1/media/:id */; thumbUrl?: string /* /api/v1/media/:id?variant=thumb */ }
interface GenerationDTO { id; tool: Tool; kind: Kind; modelId; prompt; negativePrompt?: string; params: GenerationParams;
  status: GenerationStatus; progress: number; cost: number; error?: { code: string; message: string /* English; localize by code */ };
  outputs: AssetDTO[]; input?: AssetDTO; isPublic: boolean; isFavorite: boolean;
  createdAt; startedAt?; finishedAt?; owner?: { name: string } /* only on public feeds */ }
interface ModelDTO extends Omit<ModelSpec,'provider'|'providerModel'> { provider: ProviderId; available: boolean; unavailableReason?: 'not_configured' }
interface LedgerEntryDTO { id; delta; balanceAfter; reason; generationId?: string; note?: string; createdAt }
interface ApiKeyDTO { id; name; prefix; createdAt; lastUsedAt?: number; revokedAt?: number }
interface Page<T> { data: T[]; nextCursor: string | null }
// Envelope: success → { data: T } (lists: { data: T[], nextCursor }), error → { error: { code, message, details? } }
interface CreateGenerationRequest { tool; modelId; prompt; negativePrompt?; params?: Partial<GenerationParams>; inputAssetId?; isPublic? }
// inputAssetId (required exactly when the tool needs an image): an IMAGE asset of the caller, either an upload (role 'input') or a
// picture one of their own generations produced (role 'output': "edit / animate this result"). Missing, someone else's and videos
// are the same 404 not_found. A generation started from a result shows that picture as `GenerationDTO.input`; public DTOs never do.
```

`src/lib/api-types.ts` also exports the enumerations as const arrays (`GENERATION_STATUSES`, `LEDGER_REASONS`, `USER_ROLES`,
`ASSET_ROLES`, `isTerminalStatus`), `ApiSuccess<T>`, `ApiErrorBody`, `ValidationIssue/ValidationDetails` (the `details` of a
422), and request/response types for the other endpoints (`RegisterRequest`, `LoginRequest`, `UpdateAccountRequest`,
`ChangePasswordRequest`, `CreateApiKeyRequest/Response`, `EnhancePromptRequest/Response`, `UpdateGenerationRequest`,
`ListGenerationsQuery`, `HealthDTO`). `CreateGenerationRequest` is kept equal to the zod schema in
`lib/validation/generation.ts` by a compile-time test.

`src/lib/api-client.ts`: typed `fetch` wrapper, unwraps the envelope, throws `ApiError{code,status,message,details,requestId}`;
never leaks to console. `createApiClient({ baseUrl = '/api/v1', fetch? })` and the shared `api` expose
`get<T>(path, {query?, headers?, signal?})`, `page<T>(path, opts)` (list endpoints → `Page<T>`), `post/patch<T>(path, body?, opts)`,
`delete<T = void>(path, opts)` and `upload<T>(path, file, {fieldName='file', filename?})`. `query` arrays are comma-joined
(`ids=a,b`); aborts are rethrown untouched; a dropped connection (before the headers or while the body streams) is `ApiError('network_error', status 0)`; a `path` that already has a `?query` gets `options.query` appended with `&`; a body that is not the
expected envelope is `invalid_response`; unknown server codes are replaced by `codeForStatus(status)`. `ApiError.code` is always an
`AnyErrorCode`, so ``t(`errors.${error.code}`)`` is type-safe.

### Errors — `src/lib/errors.ts`

`AppError(code, status, message, details?)` with codes → default status:
`bad_request 400, validation_failed 422, unauthorized 401, forbidden 403, not_found 404, conflict 409,
payload_too_large 413, unsupported_media_type 415, moderation_blocked 422, insufficient_credits 402,
rate_limited 429, too_many_active 429, signup_disabled 403, provider_error 502, service_busy 503, internal 500`
(the accounts/billing modules add their own codes in `lib/errors.ts`; the table of record is `ERROR_STATUS`).
`service_busy` is the deliberate 503 of the daily upstream budget guard (§17): `details.retryAfterSec` is also sent as `Retry-After`, and the
route wrapper logs it at debug, not as an error (the guard logs one throttled warning itself).
UI maps `code` → localized text via `errors.<code>` i18n keys (API `message` is English). As built: the constructor is exactly
`new AppError(code, status, message, details?, { cause }?)`; `AppError.of(code, message, details?)` uses the default status
(`ERROR_STATUS[code]`). `NotImplementedError extends AppError` (`internal`, 501). The browser-only codes `network_error` and
`invalid_response` (`CLIENT_ERROR_CODES`) plus `AnyErrorCode`, `isErrorCode`, `errorCodeOf(unknown)` and `codeForStatus(status)`
live in the same file; the `errors` message namespace must contain every `AnyErrorCode` plus `unknown` (enforced by `satisfies`).

**Generation failure codes.** `GenerationDTO.error.code` is not an `AppError` code: the job runner writes `invalid_input`, `content_policy`,
`rate_limited`, `unavailable` (also provider `auth`, so users never learn which credential is wrong), `timeout` and `internal`, and the
lifecycle writes `interrupted` (a paid provider's submit was in flight when the worker died: the job is stopped and refunded instead of being
submitted a second time). `error.message` is always English and user-safe; localize by code. Only `rate_limited`, `internal` and `interrupted`
have an `errors.<code>` text (`interrupted` through `GENERATION_FAILURE_CODES`, the code list that exists only for failed generations); the
others have studio texts (`studio.generations.failure.*`) and fall back to the English message.

### i18n — `src/lib/i18n/*`

- Locales `'ar' | 'en'`; `dir = ar ? 'rtl' : 'ltr'`. Resolution: cookie `aivore_locale` → `Accept-Language` → **`ar`** fallback.
- Dictionaries are split per namespace in `messages/<ns>.ts`, each `export default defineMessages({ en: {...}, ar: {...} })`
  where the type system **forces identical key shapes** for both languages (pass inline object literals: excess keys are only a compile error for fresh literals, and `tests/lib/i18n/messages.test.ts` additionally checks, per namespace, identical key sets and identical `{placeholder}` names at runtime). Nested objects, dotted `t('studio.generate')`,
  `{name}` interpolation, simple plural helper `plural(count, {one, other})` honoring Arabic categories (zero/one/two/few/many/other via `Intl.PluralRules`).
- Server: `const { locale, dir, t, plural } = await getI18n()`. Client: `useI18n()` (`{ locale, dir, t, plural, setLocale }`) from
  `<I18nProvider locale onLocaleChange?>`; `setLocale` writes the cookie then calls `onLocaleChange` (e.g. `router.refresh`) or reloads.
- `t(key, vars?)` takes a typed dotted `MessageKey`; `{name}` placeholders are replaced, a numeric var is formatted with the
  locale's digits **without grouping** (years/ids stay intact), an unknown placeholder is left visible, an unknown key renders as
  itself. `plural(count, { zero?, one?, two?, few?, many?, other }, vars?)` picks the category with `Intl.PluralRules`
  (`other` is the fallback; a `zero` form wins for 0 in every language) and fills `{count}` formatted with grouping.
- `defineMessages` lives in `i18n/define.ts` and the locale primitives (`LOCALES`, `Locale`, `dirOf`, `isLocale`, cookie name) in
  `i18n/locales.ts` so dictionaries and the DB schema can import them without cycles; `i18n/index.ts` re-exports both and adds
  `resolveLocale`, `parseAcceptLanguage`, `readLocaleCookie`, `localeFromHeaders`, `serializeLocaleCookie`, `createTranslator`.
- Intl formatters (`lib/utils.ts`: `formatNumber/PlainNumber/Credits/Date/DateTime/RelativeTime/Bytes/Seconds`) use the fixed tags
  `ar → ar-EG` (Arabic-Indic digits, Gregorian calendar) and `en → en-US`, so output does not depend on the ICU build.
- UI must use **logical CSS** (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `text-start`, `rtl:` variants where needed). No hard-coded `left/right`.
- Numbers/dates via `Intl` with the active locale. Arabic font: Cairo; Latin: Inter.

## 6. Server module contracts

### 6.1 `server/http` (foundation)

```ts
route<P = Record<string, never>>(opts: { auth: 'required'|'optional'|'none'; rateLimit?: { name: string; limit: number; windowSec: number; by?: 'ip'|'user' } | false /* default: GENERAL_RATE_LIMIT; false opts out */;
                 admin?: boolean; csrf?: boolean /* default: true for non-GET with cookie auth */; maxBodyBytes?: number | (() => number) /* default 1 MiB; covers EVERY way of reading the body */ },
         handler: (ctx: RouteCtx<P>) => Promise<Response | unknown>): (req: Request, nextCtx?: { params: Promise<P> }) => Promise<Response>
// Overloaded: with auth:'required' the handler receives AuthedRouteCtx<P> (auth: AuthContext, never null).
// RouteCtx: { req; params: P; auth: AuthContext | null (non-null when 'required'); ip: string; requestId: string;
//             body<T>(schema: ZodType<T>): Promise<T>  /* size-limited JSON, ValidationError → 422 with details */;
//             formData(): Promise<FormData>            /* size-limited multipart/form-data: 415 other types, 400 malformed, 413 too large */;
//             query<T>(schema: ZodType<T>): T }
// Handler may return a Response, or a plain value (→ 200 {data}). Helpers: ok(data, init?), created(data), page(rows, nextCursor), noContent().
// Wrapper: request-id header, catches AppError/ZodError/unknown → envelope, logs 5xx, applies rate limit & origin check via security/*,
// sets `Cache-Control: no-store` on API responses by default.
// As built: request id = a sane inbound `X-Request-Id` or a UUID, echoed on every response. `undefined` return → 204. Order:
// getClientIp → explicit per-address limit (`by: 'ip'`, before auth, so floods never reach the credential lookup) → authenticate (only when
// the request carries an Authorization header or the `aivore_session` cookie, so anonymous calls never touch the DB; 'none' never calls it)
// → admin check (403) → assertSameOrigin (mutating methods, when `csrf ?? auth.via==='session'`; pass `csrf: true` on login/register)
// → identity rate limit (user, address or the anonymous-unknown bucket, see below) → handler. A rate-limit rejection is 429 + `Retry-After`;
// `X-RateLimit-Limit/Remaining/Reset` are sent whenever a limit applies (the limit shown is the one of the bucket that was spent). `admin: true`
// without `auth: 'required'` throws when the route module loads. 5xx are logged at error (with the error, never the query string or
// credentials; the deliberate 503 `service_busy` is the one exception), everything else at debug. Unknown errors and `internal` AppErrors
// reach the client as `{ error: { code: 'internal', message: 'Internal server error' } }`.
// Rate limiting: a route that omits `rateLimit` gets `GENERAL_RATE_LIMIT` (`{ name: 'general', limit: 300, windowSec: 60 }`; one shared bucket per
// user/address across all such routes), so a forgotten option can never leave an endpoint unthrottled. A route with its own `rateLimit` uses only
// that one. `rateLimit: false` is the explicit opt-out (used by `/api/health` and by the media route, which spends its own budget). Every route
// therefore calls `getRateLimiter()`; tests that exercise `route()` for real use the in-memory limiter (see §6.2) or mock `@/server/security/rate-limit`.
// Keying (`by` left out, the normal case): a SIGNED-IN caller (session cookie or API key, resolved even on `optional` routes) spends `<name>:user:<id>`
// and never touches an anonymous bucket, however many anonymous requests came before; an anonymous caller spends `<name>:ip:<address>`; with an
// UNKNOWN address (no trusted proxy: `getClientIp` is 'unknown' for everybody) anonymous callers share `<name>:anonymous-unknown`, whose limit is
// `ANONYMOUS_UNKNOWN_FACTOR` (10) times the route's, one bucket per route class, so one script cannot starve signed-in users and cannot lock the
// whole site out of a route either. Requests with rejected credentials count as anonymous (they cost one HMAC and one indexed read first). An
// EXPLICIT `by: 'ip'` is the per-address budget of login/register/the public feed: counted before authentication, for everybody, unscaled, so such a
// route sizes the unknown-address case itself (`addressRoute` in `server/auth`); an explicit `by: 'user'` keys signed-in callers by account and
// anonymous ones by address, also unscaled. A spoofed `X-Forwarded-For` changes nothing while `TRUST_PROXY=false`: the request is the same
// anonymous-unknown caller (§16).
// Body size: `maxBodyBytes` (default 1 MiB, or a function evaluated per request for limits that come from `getEnv()`, since modules must not
// read the environment at import) is enforced on the request itself, not only inside `ctx.body()`. A declared `Content-Length` above it is 413
// before the handler runs, and `ctx.req` is a request whose body stream fails with `payload_too_large` the moment more than the cap has been
// read, so `ctx.req.formData()/text()/arrayBuffer()/blob()/body` and chunked uploads without a Content-Length are all capped (Next.js applies no
// limit of its own). The upload route should set `maxBodyBytes: () => (getEnv().MAX_UPLOAD_MB + 1) * 1024 * 1024` (multipart overhead) and read the
// file with `ctx.formData()`.
// Helpers (server/http): respond.ts `ok/created/accepted/page/noContent/json`; errors.ts `validationError/normalizeError/errorResponse`;
// request.ts `readJsonBody/readFormBody/capRequestBody/queryObject/parseOrThrow/pageQuerySchema ({limit 1-100 default 20, cursor})/hasCredentials/requestIdOf`.
// `queryObject` returns a prototype-less object and drops `__proto__`.
// Cursors for keyset pagination: `encodeCursor([createdAt, id])` / `decodeCursor(cursor)` in lib/utils.ts (opaque base64url JSON).
```

### 6.2 `server/auth` + `server/security` (owner `auth-security`)

```ts
interface AuthContext { user: SessionUser; via: 'session' | 'api_key'; sessionId?: string; apiKeyId?: string }
interface SessionUser { id; email; name; role: 'user'|'admin'; locale: 'ar'|'en'; creditBalance: number }
authenticate(req: Request): Promise<AuthContext | null>      // Bearer avk_… → api key; else session cookie `aivore_session`
getCurrentUser(): Promise<SessionUser | null>                // for server components (reads cookies())
registerUser(input: { email; password; name; locale }): Promise<{ user: SessionUser; token: string; expiresAt: number }>  // grants signup bonus in same tx; first ADMIN_EMAILS → admin
loginUser(input: { email; password }, meta?): Promise<{ user; token; expiresAt }>      // constant-time-ish, generic error, per-IP+email rate limit
logout(token) / logoutAll(userId) / changePassword(userId, current, next) (revokes other sessions)
createApiKey(userId, name): Promise<{ key: string /* shown ONCE: avk_<prefix>_<secret> */; record: ApiKeyDTO }>; listApiKeys; revokeApiKey
sessionCookie(token, expiresAt): string; clearSessionCookie(): string      // HttpOnly; SameSite=Lax; Path=/; Secure in production
password policy: ≥ 8 chars, ≤ 128, reject top-common passwords list (small built-in set); email normalized lowercase+trim
security/rate-limit.ts: interface RateLimiter { hit(key, limit, windowSec): { allowed; remaining; resetAt } }  sliding/fixed window, in-memory Map with periodic sweep, swappable
   (the foundation ships a working fixed-window `InMemoryRateLimiter`, `getRateLimiter()` (singleton on globalThis) and `setRateLimiter(limiter | null)`; auth-security keeps the interface and may harden or swap it)
security/origin.ts: assertSameOrigin(req) for cookie-authenticated mutating requests (Origin/Referer vs APP_URL/host; API-key requests exempt)
security/ssrf.ts: assertPublicHttpsUrl(url): resolves DNS, blocks private/loopback/link-local/metadata ranges, blocks redirects to them; safeFetch(url, {maxBytes, timeoutMs, allowedContentTypes})
security/ip.ts: getClientIp(req) (X-Forwarded-For only when TRUST_PROXY=true)
security/headers.ts: baseline security headers object used by next.config.ts (CSP, HSTS in prod, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors)
```

Routes: `POST /auth/register|login|logout`, `GET /auth/me`, `GET|PATCH /account`, `POST /account/password`,
`GET /account/ledger`, `GET|POST /keys`, `DELETE /keys/:id`.

As built: the auth and security modules are real, see §16 (the paragraph below describes the stub contract they kept). Everything is imported from `@/server/auth` (a barrel over `context.ts` (`SessionUser`, `AuthContext`,
`authenticate`, `getCurrentUser`), `users.ts` (`registerUser`, `loginUser`, `changePassword`, types `RegisterInput`, `LoginInput`,
`SessionMeta {ip?, userAgent?}`, `AuthResult`), `sessions.ts` (`logout`, `logoutAll`), `api-keys.ts` (`createApiKey` → `CreateApiKeyResponse`,
`listApiKeys`, `revokeApiKey`), `cookies.ts`, `password.ts` (`hashPassword`, `verifyPassword`, `assertPasswordPolicy`, `PASSWORD_MIN_LENGTH`,
`PASSWORD_MAX_LENGTH`)). Additive to the signatures above: `registerUser(input, meta?)` also takes `SessionMeta`, and
`changePassword(userId, current, next, keepSessionId?)` keeps the caller's own session. **`auth/tokens.ts` is real and is a storage
contract**: `hashToken(secret, pepper = SESSION_SECRET)` = hex HMAC-SHA256 of the secret keyed with the pepper, used for session tokens
(`sessions.tokenHash`) and API keys (`api_keys.keyHash`); `generateToken()` = 32 random bytes as base64url. Test factories insert
sessions with it, so auth-security must hash through `hashToken` and must keep its output stable.
`security/ssrf.ts`: `assertPublicHttpsUrl(url: string | URL): Promise<URL>` and
`safeFetch(url, { maxBytes, timeoutMs, allowedContentTypes: readonly string[], signal? }): Promise<{ bytes: Uint8Array; contentType; finalUrl }>`
(the body is buffered; `allowedContentTypes` accepts `image/*` style wildcards).

### 6.3 `server/credits` (foundation, implemented + tested)

```ts
getBalance(dbOrTx, userId): number                                             // not_found for an unknown user
grantCredits(dbOrTx, { userId; amount; reason: GrantReason; note?; generationId?; idempotencyKey? }): LedgerEntry     // idempotent on key
debitCredits(dbOrTx, { userId; amount; generationId; idempotencyKey? }): LedgerEntry                     // throws AppError insufficient_credits (balance CHECK ≥ 0 is the last line of defence)
refundGeneration(dbOrTx, generationId, opts?: { amount?: number; note?: string; idempotencyKey?: string }): LedgerEntry | null  // idempotent: total refunds ≤ debit; null if nothing left to refund
listLedger(dbOrTx, userId, { limit?; cursor? }): Page<LedgerEntryDTO>           // newest first; limit 1-100 (default 20; a non-finite limit counts as not given)
toLedgerEntryDTO(row): LedgerEntryDTO
```
As built: every function is synchronous and runs in `withTx` (`BEGIN IMMEDIATE` on a `Db`, a savepoint when given a `Tx`), so call
them inside the same transaction as the generation insert. `GrantReason` = `signup_bonus | admin_grant | purchase | adjustment`
(`generation` and `refund` only come from debit/refund). `amount` must be an integer in `1..MAX_CREDIT_AMOUNT` (1e9) else
`bad_request`. An idempotency key replays the original entry; reusing it for a different operation is `conflict`. `refundGeneration`
refunds `min(opts.amount ?? remaining, remaining)` to the user who paid, where `remaining` = debits − refunds recorded for that
generation; a partial refund with an explicit `amount` is only replay-safe if you also pass `idempotencyKey`.
`insufficient_credits.details = { required, balance }`.
Invariants (tested): balance never negative; `balanceAfter` chain consistent; refund idempotent; concurrent debits can't overdraw.

### 6.4 `server/providers` (owners `providers-mock` + provider-*)

```ts
interface ProviderInput {
  generationId: string; tool: Tool; model: ModelSpec; prompt: string; negativePrompt?: string; params: GenerationParams;
  inputImage?: { bytes: Uint8Array; mimeType: string; width?: number; height?: number };
}
interface ProviderOutput { kind: Kind; url?: string; bytes?: Uint8Array; mimeType?: string; width?: number; height?: number; durationMs?: number; seed?: number; thumbUrl?: string }
type SubmitResult = { mode: 'sync'; outputs: ProviderOutput[] } | { mode: 'async'; providerJobId: string; meta?: Record<string, unknown> };
type PollResult = { status: 'pending' | 'running'; progress?: number } | { status: 'succeeded'; outputs: ProviderOutput[] } | { status: 'failed'; error: ProviderError };
interface ProviderContext { signal: AbortSignal; env: Env; fetch: typeof fetch; log: Logger }
interface GenerationProvider {
  id: ProviderId;
  isConfigured(env: Env): boolean;
  submit(input: ProviderInput, ctx: ProviderContext): Promise<SubmitResult>;
  poll(providerJobId: string, input: ProviderInput, ctx: ProviderContext, meta?: Record<string, unknown>): Promise<PollResult>;
  cancel?(providerJobId: string, ctx: ProviderContext, meta?: Record<string, unknown>): Promise<void>;
}
class ProviderError extends Error { code: 'invalid_input'|'content_policy'|'rate_limited'|'unavailable'|'timeout'|'auth'|'unknown'; retryable: boolean; userMessage: string /* safe to show */ }
registry.ts: getProvider(id): GenerationProvider; listProviders(); isProviderAvailable(id, env)  — resolution is lazy; tests can inject fakes via setProviderOverrides()
```
Rules: providers never touch DB/storage; never log secrets/prompts at info; map upstream errors to `ProviderError`
(HTTP 401/403→auth, 429→rate_limited, 5xx→unavailable retryable, content-policy payloads→content_policy);
all `fetch` calls take `ctx.signal`; request/response shaping is unit-tested with a stubbed `ctx.fetch`.
Provider outputs given as `url` are downloaded by the **engine** through `safeFetch` (SSRF-safe) and persisted.

As built (real code; owner `providers-mock` extends it additively):
- `providers/types.ts` holds the interfaces above verbatim. `providers/errors.ts`: `new ProviderError(code, message, { retryable?, userMessage?,
  httpStatus?, retryAfterMs?, cause? })` (`PROVIDER_ERROR_CODES`, `isProviderError`). Retryable by default: `rate_limited`, `unavailable`,
  `timeout`. `message` is for logs; only `userMessage` (a generic default per code, override it) may reach users or be stored on the generation.
  `providerErrorFromStatus(status, { message?, contentPolicy?, retryAfterMs?, cause? })`: 401/402/403 → `auth`, 408 → `timeout`, 429 →
  `rate_limited`, 5xx → `unavailable` (retryable), 400/413/415/422 → `invalid_input`, other statuses → `unknown`; a content-policy payload on a
  4xx (not 429) → `content_policy`.
- `providers/http.ts`: `httpJson<T>(ctx, { url, method?, headers?, body?, timeoutMs = 30000, maxResponseBytes = 10 MiB, schema?, classifyError? })`
  → `{ status, headers, data }`. It calls `ctx.fetch` under `AbortSignal.any([ctx.signal, timeout])`, parses the JSON, validates with `schema`
  (mismatch → `unknown`, the message names paths, never values) and reports every failure as a `ProviderError` (network error → `unavailable`,
  timeout → `timeout`, `Retry-After` → `retryAfterMs`). If `ctx.signal` aborts, the abort error is rethrown untouched (cancellation is not a
  provider failure). `classifyError(failure)` lets an adapter map its own error payloads first. Request and response bodies and the query
  string are never logged; the debug line has only method, host, path, status and duration. Adapter tests build contexts with `fakeProviderContext`.
- `providers/registry.ts`: `getProvider`, `listProviders`, `isProviderAvailable(id, env)`, `setProviderOverrides(partial | null)` (replaces the whole
  override set). It imports `mockProvider` (`./mock`), `openaiProvider` (`./openai`), `falProvider` (`./fal`), `replicateProvider` (`./replicate`):
  keep those export names. `falProvider` is real (below); `openaiProvider` and `replicateProvider` are still stubs that report `isConfigured() === false`, so no model is offered through them.

**Demo (mock) provider, as built** (`providers/mock/**` and `lib/catalog/models/mock.ts`, real; the module key is `providers-mock`). `mockProvider`
serves `aivore-demo-image` (text-to-image + image-to-image; 1 credit per image; aspect ratios 1:1, 16:9, 9:16, 4:3, 3:4; count 1-4; negative prompt, seed and
strength) and `aivore-demo-video` (text-to-video + image-to-video; 3 or 5 s; 2 credits per second at 480p, 3 at 720p; seed). Both carry the `demo` badge.
- **Deterministic**: every output is a pure function of (prompt, negative prompt, seed, size), so the same request gives the same bytes. Without
  `params.seed` the seed derives from `generationId`. With `count > 1` each image gets a sub-seed (image 0 keeps the request's seed, so the seed echoed
  in `ProviderOutput.seed` reproduces that exact image alone).
- **Images** are lossy WebP (`image/webp`) in the exact requested ratio at about 1 MP (1:1 is 1024x1024, 16:9 is 1280x720, 9:16 is 720x1280, 4:3 is
  1152x864, 3:4 is 864x1152), painted procedurally with sharp (flowing colour field, one of four compositions, grain). The prompt is never drawn as text;
  it only steers the colour mood (English and Arabic keywords such as sunset, ocean, forest, night, desert, snow, flower, neon) and the composition.
  image-to-image is a seeded colour grade of the input scaled by `strength` (default 0.6, clamped to 0.1-1): it keeps the input's aspect ratio (shrunk to
  about 1 MP, never enlarged), keeps transparency and ignores `aspectRatio`.
- **Videos** are looping animated GIFs (`mimeType: 'image/gif'`, `kind: 'video'`, `durationMs` = requested seconds) with at most 30 frames and 480 px on the
  longest side, built only through `@/lib/gifenc` (one shared palette, ordered dithering). text-to-video is a flowing scene; image-to-video is a Ken Burns
  push-in with a light parallax that keeps the input's proportions. `resolution` only changes the price: the demo clip is always this small preview.
  A 5 s clip costs 1-1.5 s of CPU whatever the input (the test budget is 3 s; even a 480x360 random-noise PNG stays near 1.3 s) and no synchronous step
  blocks the event loop for more than about 0.25 s: it yields after every frame and after the palette and lookup steps. The shared palette is built from
  gifenc's 12-bit (`rgb444`) histogram because the default 16-bit one makes a noisy input cost 7 s of CPU in one blocking call. **UI note**: show these assets with
  `<img>`, not `<video>`; `persistOutput` thumbnails images only, so a video card either uses the GIF itself or needs a first-frame thumbnail from storage.
- **Async path**: `submit` returns `{ mode: 'async', providerJobId: 'mock_…', meta: { v: 1, startedAt, durationMs, seed, outcome } }` with a latency
  picked from the seed (images 2.5-4 s, videos 7-10 s). `poll` is stateless: progress (0-99) comes from `Date.now()` and `meta`, and the outputs are
  rendered by the first poll that finds the job finished, so it survives a worker restart. Damaged `meta` is a `failed` result (`unknown`, not retryable).
  `cancel` does nothing. Prompts are never logged.
- **Failure injection** for tests and E2E: a substring of the prompt (case-insensitive; the words are stripped before rendering, so they never change the
  art). `__fail__` makes the job fail after its delay with `ProviderError('unavailable', { retryable: false })`; `__content__` fails it with
  `content_policy` (wins over `__fail__`); `__slow__` makes it take 25 s; `__sync__` makes `submit` return `{ mode: 'sync', outputs }` at once (with
  `__fail__` or `__content__` it throws that error from `submit`). The same list is in the header of `providers/mock/index.ts`.

**fal provider, as built** (`providers/fal/**`, `lib/catalog/models/fal.ts`; module key `provider-fal`). `isConfigured` is `Boolean(env.FAL_KEY)`. It uses fal's QUEUE API and
is always async: `submit` POSTs the per-model body to `https://queue.fal.run/<endpoint>` with `Authorization: Key <FAL_KEY>`; `providerJobId` is fal's `request_id` and `meta` is
`{ v: 1, requestId, statusUrl, responseUrl, cancelUrl }` (URLs always https on `queue.fal.run`/`*.fal.run`, rebuilt when missing or damaged; the key is only ever sent to those hosts and
never lands in `meta`, logs or errors). `poll` does one status GET (IN_QUEUE → pending, IN_PROGRESS → running; fal reports no progress percentage) and, on COMPLETED, fetches the
result; it returns `failed` for FAILED/ERROR/CANCELED, for a COMPLETED status that carries an error, and for a typed fal error payload or plain 4xx on the result fetch, but THROWS a
`ProviderError` when the state could not be read: retryable for a network error, 429 and a bare 5xx/408 (so the engine polls again and a generated, billed result is not destroyed), not
retryable for `auth`. `cancel` PUTs the stored
`cancelUrl` (400 ALREADY_COMPLETED counts as done). Error mapping is by fal's `type`/`error_type`/`X-Fal-Error-Type` codes, never by regex over text (messages echo the prompt and never
reach users): 401/402/403 → `auth`, 429 → `rate_limited`, 408/504/timeouts → `timeout`, 5xx → `unavailable`, `content_policy_violation` → `content_policy`, bad image
errors → `invalid_input`. Images the safety checker flagged are dropped (all flagged = `content_policy`), as is a text-only answer (a refusal). **A submit that ends without any HTTP
status (network error, timeout, lost response body) is final and not retried** (`retryable: false`), because fal has no idempotency key and the request may have been accepted. Input
images go inline as base64 data URIs (4 MiB cap, re-encoded/flattened where the model needs it; FLUX img2img input is shrunk under 1 MP, sides multiples of 16, because fal bills
output megapixels). Moderation is a product default: `safety_tolerance: '2'` on Nano Banana Pro (+ Edit), FLUX.2 pro and Veo, `auto_fix: false` on both Veo endpoints (a prompt that
fails the content rules is rejected as `content_policy` and refunded instead of being rewritten and generated); Wan and FLUX.1 keep fal's defaults. The single constant is
`SAFETY_TOLERANCE` in `adapters/shared.ts`.
Catalog: nine models with `fal-`-prefixed public ids so they cannot collide with other providers: text-to-image `fal-flux-schnell` (1 credit/img, count 1-4, badge fast), `fal-flux-2-pro`
(8, count 1), `fal-nano-banana-pro` (38); image-to-image `fal-nano-banana-pro-edit` (38), `fal-flux-dev-img2img` (10, the only one with strength); text-to-video `fal-wan-2-6-t2v`
(25/s at 720p, 38/s at 1080p, 5/10/15 s) and `fal-veo-3-1-fast` (38/s at 720p, 4/6/8 s, audio); image-to-video `fal-wan-2-6-i2v` and `fal-veo-3-1-fast-i2v` (same prices). 1 credit is about
USD 0.004 of UPSTREAM cost, every price is the upstream price divided by 0.004 and rounded up per unit. `fal-nano-banana-pro-edit`, `fal-flux-dev-img2img` and `fal-wan-2-6-i2v` keep
the input image's proportions and carry `limits.followsInputAspect` (the Veo image-to-video model honours the chosen 16:9/9:16). **Verification status: nothing was called live** (the
build sandbox's egress policy blocks every fal host); endpoint ids, fields and enums come from the generated types of `@fal-ai/client` 1.11.0-alpha.5, the queue protocol from its source,
prices from fal page excerpts of 2026-10-08, some months old (`fal-flux-dev-img2img` is priced at the higher of two conflicting quotes, marked `UNVERIFIED:` in the catalog), see §17.

**Provider verification rule**: real-provider owners must try to verify endpoints, request/response shapes and model ids
against the official docs (WebFetch/WebSearch, load via ToolSearch). Anything not verifiable is isolated behind the adapter,
marked `// UNVERIFIED:` and listed in `openIssues`. Never invent model ids — fewer, verified models beat many guesses.

### 6.5 `server/storage` + `server/uploads` (owner `storage`)

```ts
interface StorageDriver {
  put(key: string, body: Uint8Array | NodeJS.ReadableStream, opts: { mimeType: string }): Promise<{ bytes: number }>;
  get(key: string, range?: { start: number; end?: number }): Promise<{ stream: ReadableStream<Uint8Array>; size: number; mimeType: string; range?: { start: number; end: number } }>;
  head(key: string): Promise<{ size: number; mimeType: string } | null>;
  delete(key: string): Promise<void>;
  signedUrl?(key: string, ttlSec: number): Promise<string | null>;
}
getStorage(): StorageDriver     // by env STORAGE_DRIVER; local driver is path-traversal-proof (keys validated /^[a-z0-9/_\-.]+$/, no .., resolved under root)
keys: `u/<userId>/<generationId|uploads>/<assetId>.<ext>`; thumbs `…/<assetId>.thumb.webp`
uploads/: acceptUpload(file: File, userId): Promise<AssetRecord>   // size limit, magic-byte sniff (png/jpeg/webp only), sharp decode (rejects polyglots/decompression bombs via limitInputPixels), strips EXIF, normalizes to ≤ 4096px, stores + thumb, creates asset row (role 'input')
persistOutput(storage, input): Promise<PersistedOutput>   // used by the engine: store bytes, probe dims with sharp (images), make thumb (images). It does NOT insert the asset row: completeGeneration inserts the rows in the same tx that marks the generation succeeded
GET /api/v1/media/:assetId[?variant=thumb] — access: owner (session or API key) OR an OUTPUT of a public generation whose owner's account is enabled; Range support (206) for video; ETag; Cache-Control private vs public; `X-Content-Type-Options: nosniff`; Content-Disposition inline (or attachment with ?download=1); S3 is streamed through the app (never a 302, see "as built")
POST /api/v1/uploads (multipart `file`) → { data: AssetDTO }
```

Signatures fixed by the stub step (the real modules follow, see "Storage and uploads, as built" below): `storage/types.ts` exports `StorageDriver`, `StorageRange`, `StorageReadResult`, `StoredObjectInfo` and
`STORAGE_KEY_PATTERN`. `storage/index.ts` is wiring: `getStorage()` (lazy, kept on `globalThis`, chosen by `STORAGE_DRIVER`) and
`setStorageOverride(driver | null)` for tests; it calls `createLocalStorage(rootDir)` (`local.ts`) and `createS3Storage(env)` (`s3.ts`).
`uploads/index.ts`: `acceptUpload(file, userId): Promise<AssetRecord>` (`AssetRecord = AssetRow`),
`persistOutput(storage, { userId, generationId, index, kind, bytes, mimeType, durationMs?, width?, height? }): Promise<PersistedOutput>` where
`PersistedOutput = { assetId, index, kind, storageKey, thumbKey?, mimeType, bytes, width?, height?, durationMs?, sha256? }`, and
`removeAssetObjects(storage, assets)` (best effort, for deletes). `uploads/sniff.ts`: `sniffImageType(bytes)`, `extensionForMime`, `UPLOAD_MIME_TYPES`;
`uploads/image.ts`: `normalizeUpload`, `probeImage`, `makeThumbnail`. `toAssetDTO(row)` lives in `generations/dto.ts` (real).

**Storage and uploads, as built** (real code, module key `storage`; additive to the signatures above).
- `storage/types.ts`: `StorageRange.start` may be negative = suffix range (`{ start: -500 }` is the last 500 bytes, `end` omitted); `RangeNotSatisfiableError(size)` (an `AppError` `bad_request`, status
  416, `details.size`) and `isRangeNotSatisfiable()`. `storage/keys.ts` (`isValidStorageKey`/`assertStorageKey`/`MAX_STORAGE_KEY_LENGTH`) is `STORAGE_KEY_PATTERN` plus: no empty, `.`, `..` or
  dot-leading segments, at most 512 characters, segments at most 200. `storage/range.ts` `resolveStorageRange(range, size)` gives inclusive offsets or throws the 416 error.
- `LocalDriver`: every path is resolved under the canonical root and any symlink on the way (directory or final file, dangling ones too) is refused, opens use `O_NOFOLLOW`; writes go through a hidden temp
  file, fsync, rename (a failed stream leaves nothing); the mime type lives in a hidden `.<name>.meta` sidecar; it fsyncs every write and does not remove empty directories after deletes.
  `S3Driver` (`createS3Storage(env, { client?, partBytes? })`): `PutObject` for small bodies, multipart (one part in memory, aborted on failure) for streams, ranged GET, HEAD, delete, presigned
  `signedUrl`; ONLY `NoSuchKey` and `NotFound` map to `not_found` (get), `null` (head) and a silent no-op (delete), `NoSuchBucket` and other 404 codes surface as errors; checksums are sent only
  `WHEN_REQUIRED` (UNVERIFIED on MinIO/R2). The S3 driver was only tested against an injected client and a canned SDK response, never a real endpoint.
- `acceptUpload(file, userId)`: reads in chunks and cancels at `MAX_UPLOAD_MB` whatever size the file claims; magic-byte sniff (PNG/JPEG/WebP only); structure checks (truncation, trailing data, APNG
  and animated WebP are refused; JPEGs with appended pictures such as gain maps pass, JPEGs with other trailing data, e.g. Samsung Motion Photos, are rejected as polyglots); sharp decode under a 50 MP limit
  with `failOn: 'error'`, EXIF orientation applied, all metadata stripped, scaled to at most 4096 px, a 512 px WebP thumbnail, `assets` row with role `input`; nothing of the original bytes survives. A failed
  write removes what was already stored. `persistOutput(storage, input)` takes bytes or a stream plus optional `thumbBytes`; the real type comes from the BYTES, not the provider's claim: images are probed
  with sharp (SVG and other non-browser formats are refused), videos are recognised by container (ftyp MP4/MOV, EBML WebM, animated GIF with a first-frame thumbnail); a claimed `video/mp4` or
  `video/quicktime` is believed only when the bytes open with `ftyp` or one of the atoms `moov mdat free wide skip pnot` (`startsWithQuickTimeAtom`; add to `LEADING_ATOMS` if a real provider turns out
  to open with another box). It throws `bad_request` (or `payload_too_large`) for unusable output, which the engine turns into a failed, refunded generation; it never inserts the asset row, leaves nothing
  in storage when it throws and releases the provider download stream on every failure path. `deleteAssetObjects(assets)` (uses `getStorage()`) is what the engine calls after deleting rows. Mime allowlist:
  png, jpeg, webp, gif, avif, mp4, webm, mov (`servableMimeType`); `extensionForMime` gives `bin` for anything else.
- `POST /api/v1/uploads`: auth required, 20/min per user (`uploads`), body cap `(MAX_UPLOAD_MB + 1)` MiB read through `ctx.formData()` and enforced while streaming, exactly one multipart field `file`; 201
  `{ data: AssetDTO }`; errors 401, 403 (CSRF), 413, 415 (type or not multipart), 422 (not exactly one file), 400, 429.
- `GET|HEAD /api/v1/media/:assetId[?variant=thumb][&download=1|true]`, auth optional. **Visibility** (`app/api/v1/media/access.ts`, `findVisibleAsset`): the owner (cookie or API key) sees every asset of
  theirs; everybody else sees only an asset with role `output` of a generation with `isPublic = true` **whose owner's account is enabled** (`users.disabledAt` is null: a disabled account's shared results
  are offline everywhere, media URLs included, exactly like the public feed and share page; `enable` brings them back); input assets are never shared, even when the generation made from them is.
  Everything else, malformed ids included, is the same 404 body (never 403), also for 304 and Range requests. An unknown `variant` is 422. `Range` gives 206, or 416 with `Content-Range: bytes */size`;
  multi-range, malformed ranges, other units and a stale `If-Range` fall back to 200; `ETag "<assetId>-original|thumb"` + `If-None-Match` give 304. Content-Type comes only from the allowlist (an unknown
  stored type is `application/octet-stream` and forced to download); `nosniff` and `Cross-Origin-Resource-Policy` are always set; the attachment filename is built from the asset id, never from user text;
  `Cache-Control` is `private, max-age=3600` (+ `Vary: Cookie, Authorization`) for owners and `public, max-age=300` for shared output. **S3 is streamed through the app**, never redirected to a signed
  URL: the CSP allows `img-src`/`media-src` for `'self'` only, and streaming keeps authorization on every request. No route-level CSP is set on media (next.config headers override it).
- **Media rate limit** (`rateLimit: false` on the route, spent inside `withMediaRateLimit`): 1200/min per signed-in user, 1200/min per client address for anonymous viewers when the address is known, and
  anonymous viewers whose address is unknown (`TRUST_PROXY=false`) are NOT counted at all, because one shared bucket would let a single script lock every anonymous viewer of a public page out;
  throttle those at the reverse proxy or CDN (public assets are cacheable for 5 minutes). 429 carries `Retry-After`; `X-RateLimit-*` is sent on every counted answer, 404/416/422 included.
- Not built: a sweeper or per-user quota for uploads that are never used (role `input` assets that no generation references are never cleaned up, and deleting a generation keeps its input upload on
  purpose); `tests/helpers/fakes.ts` `fakeStorage` is laxer than the real drivers
  (400 instead of 416 for bad ranges, no suffix ranges, accepts `a/./b` keys).

### 6.6 `server/generations` + `server/jobs` (owner `engine`)

```ts
// service.ts (called by routes)
createGeneration(userId, req: CreateGenerationRequest, opts?: { idempotencyKey?: string }): Promise<{ generation: GenerationDTO; created: boolean }>
   // validate (lib/validation) → ensure model available → input image owned by user (upload or own output) → moderation (prompt, negative prompt, hasInputImage) → cost
   // → ONE sync DB tx: replay check → active-limit → daily upstream budget (paid providers) → debit credits + insert generation('queued') → wake worker
getGeneration(userId, id) / listGenerations(userId, { kind?, status?, favorite?, q?, ids?, limit, cursor? }) / listPublicGenerations({ kind?, limit, cursor? })
updateGeneration(userId, id, { isPublic?, isFavorite? }) / deleteGeneration(userId, id) / cancelGeneration(userId, id)  // cancel: queued|processing → canceled + refund
getPublicGeneration(id): GenerationDTO | null           // for /s/[id]
// lifecycle.ts (used by runner; all state changes are compare-and-set, sync tx)
claimNextJob(workerId, leaseMs): GenerationRow | null              // BEGIN IMMEDIATE; queued (or expired-lease processing) → processing, attempts++
extendLease(id, workerId, leaseMs): boolean
markSubmitStarted(id, workerId): boolean                           // CAS right BEFORE provider.submit (the "submit started" marker, §8)
recordSubmitted(id, workerId, providerJobId, meta): boolean        // stores the job id AND clears the marker
updateProgress(id, workerId, progress): void
completeGeneration(id, workerId, outputs: PersistedOutput[]): boolean   // processing→succeeded; inserts asset rows; partial refund if fewer outputs than count
failGeneration(id, workerId|null, error: { code; message }): boolean    // processing|queued→failed + full refund (idempotent)
requeueStale(): number                                                   // expired leases → queued, or failed+refund when attempts ≥ MAX_ATTEMPTS; a paid job with the marker and no job id → failed 'interrupted' + refund
// runner.ts
class JobRunner { constructor(deps: { db; storage; providers; env; log; now? }); start(); stop(): Promise<void>; wake(); tick(): Promise<number> }
   // loop: claim up to WORKER_CONCURRENCY jobs; processJob is RESUMABLE (providerJobId present → straight to polling);
   // heartbeat extends lease every 15 s; poll backoff images 1→3 s, video 3→10 s (jittered); timeout per kind;
   // retryable submit errors retried with backoff ≤ MAX_ATTEMPTS; between polls re-read status: if canceled → provider.cancel (best effort) and stop;
   // outputs: url → safeFetch (SSRF-safe, size cap 500 MB) → storage.put → sharp probe + thumb → completeGeneration; any error → failGeneration (refund)
start.ts: startWorker() singleton on globalThis (HMR-safe); instrumentation.ts calls it only when NEXT_RUNTIME==='nodejs' && WORKER_MODE==='inline'
scripts/worker.ts: standalone entry for WORKER_MODE=external (graceful SIGTERM)
```
Signatures fixed by the stub step (all real now): the `lifecycle.ts` functions take the connection first, like the credits functions
(`claimNextJob(db, workerId, leaseMs, now?)`, `extendLease(db, id, workerId, leaseMs, now?)`, `recordSubmitted(db, id, workerId, providerJobId, meta?)`,
`updateProgress(db, id, workerId, progress)`, `completeGeneration(db, id, workerId, outputs: PersistedOutput[])`,
`failGeneration(db, id, workerId | null, error)`, `requeueStale(db, now?)`), and stay synchronous. `service.ts` functions are async except
`getPublicGeneration`; `listGenerations(userId, ListGenerationsQuery)` and `listPublicGenerations({ kind?, limit?, cursor? })` return `Page<GenerationDTO>`;
`updateGeneration(userId, id, UpdateGenerationRequest)` and `cancelGeneration` return the `GenerationDTO`. `queries.ts` (`findGenerationRow`,
`findOwnedGenerationRow`, `countActiveGenerations`, `hydrateGenerations`) is internal to the engine. `dto.ts` is real: `toGenerationDTO(row, { outputs, input?, owner? })`
never exposes provider, provider job id/meta, worker, lease, attempts, idempotency key or owner id. `JobRunnerDeps = { db, storage, providers: { getProvider }, env, log, now? }`;
`jobs/worker.ts` `createJobRunner(overrides?)` and `jobs/start.ts` `startWorker()` / `stopWorker()` wire the real `JobRunner`.

Routes: `POST|GET /generations`, `GET|PATCH|DELETE /generations/:id`, `POST /generations/:id/cancel`, `GET /explore` (public feed, no auth).
`GET /generations?ids=a,b,c` supports cheap batch polling by the UI (UI polls active ones every 1.5–4 s with backoff and pauses when the tab is hidden).
`Idempotency-Key` header on `POST /generations`.

**Engine, as built** (real code, module key `engine`; the paragraph above describes the signatures the stubs fixed).
- **`createGeneration`**: `validateGenerationRequest` (422 `validation_failed`, `details.issues`), then the idempotent-replay lookup, then model availability, the input image, moderation, and finally ONE synchronous
  `BEGIN IMMEDIATE` transaction (replay check, active count, daily upstream budget, `debitCredits`, insert `queued`), then `wakeWorkers()`. Nothing is awaited inside the transaction, so the active-generation limit (429 `too_many_active`,
  `details.limit`), the platform's daily upstream budget (503 `service_busy`, paid providers only, `generations/budget.ts`, §17) and the balance (402 `insufficient_credits`) are race-safe across processes; the unique `(userId, idempotencyKey)` index is only a backstop. A replay returns the ORIGINAL generation (`created: false`,
  HTTP 200 plus `Idempotent-Replayed: true`) even if the user is now at the limit or out of credits; the same key with a different request (tool, model, prompt, negative prompt, params, input asset) is 409 `conflict`
  with `details.reason: 'idempotency_key_reused'`. Keys are 1-128 visible ASCII characters. A model whose provider is not configured is 409 `conflict` with `details: { reason: 'model_unavailable', modelId }`; an
  input asset that is missing, someone else's or not an IMAGE is the same 404 `not_found` (`details.path: 'inputAssetId'`); the asset may be an upload (role `input`) or an output of one of the caller's own
  generations (role `output`: edit or animate a result), never a video and never anybody else's, public or not. Moderation: `moderatePrompt(prompt, { negativePrompt, hasInputImage })`. The prompt is moderated like a
  prompt; the negative prompt is NOT (a negative such as "nsfw, nude" is exactly what users should write) but is handed to the moderation module, which blocks one that excludes two or more garment/censorship
  groups to steer a person-prompt toward nudity (`sexual_explicit`); and an `image-to-*` request counts as a photo edit (`hasInputImage`): any nudity or undress wording is blocked as `non_consensual_sexual`.
  The id is `newId('gen', createdAt)`.
- **Reads and writes**: `getGeneration`/`updateGeneration`/`cancelGeneration`/`deleteGeneration` answer 404 for other users' ids and for malformed ids alike. `updateGeneration` only ever writes `isPublic` and
  `isFavorite`. `cancelGeneration` is idempotent for a canceled generation and 409 `conflict` for a succeeded or failed one. `deleteGeneration` first cancels and refunds a queued or processing generation (same
  transaction), detaches its ledger rows (`generationId` becomes null), removes the output asset rows and then, best effort, the stored files; uploaded inputs are kept. `listGenerations` filters `kind`, `status`,
  `favorite`, `q` (LIKE with escaped wildcards) and `ids` (batch polling: the service takes at most 50 and silently drops other users' and unknown ids, no cursor; the ROUTE is stricter and answers 422 for an empty list, more than 50 or any id that is not a well-formed `gen_` id), pages by keyset `(createdAt, id)` (stable under equal timestamps) and
  hydrates with a fixed number of queries. `listPublicGenerations`/`getPublicGeneration` return only `isPublic` + `succeeded` generations of enabled accounts, with `owner.name` and without the input image and
  without the favorite flag (always `false`).
- **`lifecycle.ts`** additions: `markCanceled(db|tx, userId, id)` (owner-scoped cancel + full refund), `releaseJob(db, id, workerId)` (processing -> queued without counting the attempt, keeps the provider job
  id/meta), `releaseWorkerJobs(db, workerId | workerIds[])`, `INTERRUPTED_FAILURE`, and the optional last parameters `claimNextJob(..., now?, { maxAttempts?, excludeIds? })` / `requeueStale(db, now?, { maxAttempts?, excludeIds? })`
  (`maxAttempts` defaults to `MAX_ATTEMPTS`; `excludeIds` are generations the caller is still running itself: never claimed, never requeued, never failed, so a stall longer than the lease cannot make a runner run its own
  live job a second time). `claimNextJob` is fair between users: the owner with the fewest jobs running right now (live lease) goes first, then the oldest job, so one account that queues its whole allowance of videos
  cannot hold every worker slot while others wait; it never idles a slot (a lone user still gets all of them).
  Idle polls read before they write, so a worker with nothing to do never takes the write lock. A partial result refunds `floor(cost * missing / count)` with idempotency key `refund:partial:<id>`; fail and cancel
  refunds use `refund:<id>`. `failGeneration` stores `errorCode` <= 64 and `errorMessage` <= 500 characters. `completeGeneration` throws a `RangeError` for an empty output list (use `failGeneration`).
- **`jobs/runner.ts`**: `JobRunnerDeps` also takes `sleep(ms, signal)`, `random`, `fetch`, `fetchOutput` (default `safeFetch`), `persistOutput` and `tuning` (`leaseMs` 60 s, `heartbeatMs` 15 s, `idleMs` 1 s,
  `shutdownGraceMs` 8 s, `maxPollErrors` 5). `workerId` is `worker-<pid>-<8 hex>` and names the runner in logs; what a claim writes to `generations.workerId` is `<workerId>/<n>`, one identity per claim, so a run that
  lost its job (and any call it left hanging in the background) can never act on a later claim of the same job, not even one by the same runner. A claim pass leaves the jobs the runner is still running alone
  (`excludeIds`, see above). `tick()` recovers expired leases, claims up to `WORKER_CONCURRENCY` jobs and resolves when they are finished; `start()` runs the
  same pass in a loop (`wake()` or a finished job cuts the idle wait); `stop()` stops claiming, waits up to the grace period, then aborts the rest, which hand their jobs back with `releaseJob`; `abandon()` is the
  synchronous version for `process.on('exit')`, which `startWorker()` registers (inline mode), so a restarted server resumes its jobs at once instead of after the lease. `jobs/wake.ts` (`onWake`, `wakeWorkers`) is how
  the service reaches the runner of its own process; with `WORKER_MODE=external` the worker finds new jobs on its idle poll (1 s).
- **One job** (`jobs/job-run.ts`): input image (an upload or an earlier result of the same user, role `input` or `output`) loaded from storage for `image-to-*` (on every claim, because providers need it on `poll` too; gone or not
  the user's = `invalid_input` with a refund) -> `markSubmitStarted` (CAS, see "Duplicate paid jobs" below) -> `provider.submit` (retryable `ProviderError`s are retried with
  2 s, 4 s ... backoff up to `MAX_ATTEMPTS` tries, honouring `retryAfterMs`; the marker is cleared before each back-off) -> sync outputs, or `recordSubmitted` + poll (images 1 -> 3 s, videos 3 -> 10 s, x1.5 per poll, +-20% jitter; retryable poll errors are
  tolerated up to `maxPollErrors` in a row) -> outputs: `bytes` as they are, `url`/`thumbUrl` through `safeFetch` (https only, `image/*`/`video/*`, 64 MB per image, 500 MB per video; one retry after a transient
  failure) -> `persistOutput` -> `completeGeneration`. At most `params.count` outputs are kept; an output that cannot be downloaded or is not a usable image/video is skipped (the missing share is refunded), none usable
  = `failed`. Before every poll the row is re-read: `canceled` or deleted -> `provider.cancel` (best effort) and stop without persisting; taken over by another worker -> stop without touching anything. The upstream
  cancel is bounded: the run stops waiting after 10 s or as soon as the runner is shutting down, even for an adapter that ignores the signal and never answers, so it can never hold a worker slot or `stop()`. A job that
  times out is failed and refunded BEFORE the upstream cancel is attempted.
  Files written for a result that no longer completes (canceled, lost, error half way) are deleted. A background heartbeat extends the lease every 15 s (and notices a cancel or a takeover during a long call), a
  deadline timer enforces `GENERATION_TIMEOUT_SEC_IMAGE/VIDEO` from the claim, and a provider or storage call that ignores the abort cannot hold a worker slot. Progress: 3 after preparing, 10 once submitted,
  the provider's own number squeezed into 10-85 (+4 per poll when it reports none), 90 while storing, 100 on completion; it never goes backwards.
- **Failure codes** stored in `generations.errorCode` / `GenerationDTO.error.code`: `invalid_input`, `content_policy`, `rate_limited`, `unavailable` (also provider `auth`, so users never learn which credential is
  wrong), `timeout`, `internal` (provider `unknown` and every unexpected error, always with the generic message "The generation failed unexpectedly."; details only in the log). The message is the provider's
  `userMessage` or text written by the engine, never an upstream message. A job interrupted `MAX_ATTEMPTS` times is `unavailable`: "The generation was interrupted and could not be completed." A paid job whose
  submit may have reached the provider before a crash is `interrupted` (below).
- **Duplicate paid jobs (submit guard).** fal has no idempotency key, so re-submitting a job that was already accepted creates a second PAID request. Before it calls `provider.submit` the run writes
  `generations.submitStartedAt` in a compare-and-set (`markSubmitStarted`: only for the worker that owns the job, only while `providerJobId` is null); `recordSubmitted` stores the job id and clears it in one
  statement; completion, failure, cancellation and a retryable submit error clear it too. A job found with the marker set, no `providerJobId` and a paid provider (`isPaidProvider`: anything but `mock`) is
  INDETERMINATE: on claim (`claimNextJob`, e.g. a job handed back by a graceful shutdown while the submit was in flight), on requeue (`requeueStale`, expired lease: the crash case; this wins over the attempt limit)
  it is failed with code `interrupted` and the message "The generation was interrupted before the provider confirmed it, so it was stopped to avoid a duplicate charge. Your credits were refunded; please try
  again." and refunded in full (idempotent `refund:<id>`), and it is never submitted. A synchronous paid provider is treated the same way (a crash between the response and `completeGeneration` loses the result:
  one charge, one refund). The Demo provider costs nothing and simply submits again. If the frozen worker wakes up later and its submit returns a job id, `recordSubmitted` finds the row failed and the run cancels
  that orphaned upstream job (`provider.cancel`, best effort; a row that someone else failed counts like a canceled one). Cost of the guard: a deploy that stops a worker exactly while a submit is in flight fails
  that one job (refunded) instead of risking a double charge.
- **Routes** (all through `route()`; limits are named buckets): `POST /generations` 30/min per user (`generations-create`, body <= 64 KiB, 201 created / 200 replay, both with a `Location` header); `GET /generations` and `GET /generations/:id`
  600/min per user (`generations-read`, generous because the studio polls `?ids=` every 1.5-4 s from every open tab) plus 60/min per user for `?q=` searches (`generations-search`); `PATCH`/`DELETE`/`cancel` 60/min per
  user (`generations-write`); `GET /explore` 60/min per client address (`explore`, `auth: 'none'`, so credentials are never read; `Cache-Control: public, max-age=15, stale-while-revalidate=45`; default page 24),
  built with `addressRoute` (§16): when the client address is unknown (no trusted proxy) everybody shares one 1200/min budget (`explore-shared`) instead of the 60/min one, which a single caller could use up for the whole site.
  `GET /generations` query: `kind`, `status`, `favorite` (`true|false|1|0`), `q` (1-200), `ids` (comma separated or repeated, <= 50 valid `gen_` ids), `limit` 1-100 (default 20), `cursor`. `DELETE` answers 204.
  Behind a reverse proxy without `TRUST_PROXY=true` every anonymous caller shares one address (see §16, "Client address"); set it, or the per-client 60/min does not apply and the shared 1200/min is all there is.
- **Start-up and policy.** `instrumentation.ts` starts the inline runner through `startWorkerWithRetry(log)` (`jobs/start.ts`): a failed start (a transient `SQLITE_BUSY` while another process migrates, a storage wiring error) is
  logged and retried after 1 s, 2 s, 4 s ... (30 s at most) from an unref'd timer until it works or `stopWorker()` is called; `isWorkerRunning()` says whether this process has a runner (the foundation-owned `/api/health`
  only reports the configured `WORKER_MODE`). A cancel (or a delete of an active generation) refunds in full even after the provider accepted the job (§8, a documented policy, not changed); each such cancel logs
  `Canceled a generation after it was submitted to the provider` (ids and cost only, never the prompt) so an account that creates and cancels in a loop shows up as a high ratio of those lines to `Generation succeeded`.

### 6.7 `server/moderation`, `server/prompt` (owner `catalog`)

```ts
moderatePrompt(text: string, opts?): Promise<{ allowed: boolean; category?: ModerationCategory; reason?: string }>  // built-in conservative multilingual (en+ar) blocklist + MODERATION_BLOCKLIST + optional OpenAI moderation; fail-open ONLY for the remote check, never for the local list
enhancePrompt({ prompt, kind, locale? }): Promise<{ prompt: string; engine: 'openai'|'anthropic'|'heuristic'; translated: boolean }>
   // LLM path: translate Arabic→English when the target models are English-centric + enrich (subject, style, lighting, composition); returns ONLY the prompt; heuristic path appends tasteful descriptors, never calls network
```
`lib/validation/generation.ts`: `validateGenerationRequest(req, env?) → { ok: true; model; prompt; negativePrompt?; params /* normalized */; cost } | { ok: false; errors: GenerationValidationIssue[] }` – checks tool/model compatibility, prompt length, allowed aspect ratio/duration/resolution/count, requires `inputAssetId` iff tool needs an image, clamps defaults.

As built (real code, module key `catalog`; additive to the signatures above):
- **Validation** (`lib/validation/{generation,generation-params,prompt,visible-text}.ts`). `validateGenerationRequest(request, env?: { ENABLE_MOCK_PROVIDER?: boolean })` (the structural `env` type keeps `lib/` free of server
  imports; pass `getEnv()`; Demo models are unknown when the Demo provider is off) never throws for bad input and reports ALL problems at once, in request-field order. **Result shape**: `{ ok: true; model; prompt /* trimmed */;
  negativePrompt? /* trimmed, absent when blank or invisible */; params /* defaults filled, every value one the model allows */; cost /* computeCost of params */ }` or `{ ok: false; errors: GenerationValidationIssue[] }`,
  each issue `{ path, code, message }` where `path` is the request field in the same dotted form as `ValidationDetails.issues` (`prompt`, `params.count`, `inputAssetId`, ...; `{ issues: result.errors }` is a valid
  422 `details`) and `code` is one of `invalid_request invalid_type required unknown_field unknown_tool unknown_model model_tool_mismatch too_long not_allowed out_of_range unsupported unpriced`.
  Also exported: `validateForModel(request, model)`, `defaultParamsFor(model)`, `createGenerationRequestSchema` (the zod shape of the body, strict: unknown keys are rejected), `GenerationValidationCode`,
  `enhancePromptRequestSchema`/`MAX_ENHANCE_PROMPT_CHARS` (2000), `visibleText`/`hasVisibleText`/`INVISIBLE_CHARS`. Rules the studio and API clients must know: an option the model does not offer
  (negative prompt, seed, strength, duration, resolution) is a 422, never silently dropped; `params.strength` is also refused for tools without an input image; a blank negative prompt counts as absent; a prompt
  with no visible character (zero-width, bidi, soft hyphen, Hangul filler, blank braille...) is `required`; prompt length is counted in characters (code points); a model with `limits.followsInputAspect` accepts any
  known `aspectRatio` for an image-input tool and ignores it (`params.aspectRatio` stays the model default), garbage is still `not_allowed`. `lib/tools` also exports `isTool`, `getToolsForKind`, `toolNeedsImage`,
  `filterModelsForTool`.
- **Moderation** (`server/moderation/**`). `moderatePrompt(text, { negativePrompt?, hasInputImage?, signal?, fetch?, env?, remoteTimeoutMs? })`. Text is normalized (Unicode, accents, zero-width/bidi,
  Arabic diacritics/tatweel/hamza variants, look-alike letters, repeated letters, leetspeak, spelled-out letters `p o r n`, a stated age under 18) and matched by whole token (Scunthorpe-safe) against English and Arabic rules
  in `terms.ts`/`vocabulary.ts` with combination rules for ambiguous words. Categories (`ModerationCategory`, `MODERATION_CATEGORIES`): `sexual_minors` (never relaxed), `non_consensual_sexual`, `sexual_explicit`,
  `graphic_violence`, `hate`, `terrorism`, `blocklist` (`MODERATION_BLOCKLIST` gets the same obfuscation resistance). `hasInputImage` (image-to-*) makes any nudity or undress wording block as
  `non_consensual_sexual`; `negativePrompt` is blocked only when it excludes two or more garment/censorship groups for a person-prompt (an ordinary "nsfw, nude, child" passes). Text over `MAX_MODERATED_CHARS`
  (20000) throws 422. `MODERATION_PROVIDER=openai` adds a call to `https://api.openai.com/v1/moderations` (only categories that map to this policy block; fail-open on error, timeout, bad response and missing
  key, never for the local rules). A result carries only the category and a generic reason, the log never the prompt. Known limits: reversed text, words split by other words, images/OCR, dialects; the lists
  are a starting point for a native-speaking reviewer; keep `MODERATION_PROVIDER=openai` on for a real deployment. Known conservative side effects: a main prompt that spells out "no nudity" is blocked (put it in
  the negative field), `son`/`daughter`/`baby` count as minors next to sexual wording, Arabic `نيك` is blocked even as the name Nick.
- **Prompt enhancer** (`server/prompt/**`). `enhancePrompt(EnhancePromptRequest, { env?, fetch?, signal?, timeoutMs? })` over OpenAI Chat Completions and the Anthropic Messages API (plain fetch, 8 s timeout, models
  from env), `PROMPT_ENHANCER=auto` tries OpenAI, then Anthropic, then the heuristic engine; a forced engine falls back only to the heuristic one. The draft is data (wrapped in `<draft>` tags, angle brackets stripped),
  the output is cleaned (fences, preambles, labels, quotes, 1000 characters), a refusal or leaked draft marker falls through to the next engine, `translated` is true only when Arabic went in and non-Arabic came out.
  `enhanceHeuristically` never touches the network, keeps the user's language and is idempotent. UNVERIFIED (written without the vendors' docs, stubbed-fetch tests only): the OpenAI moderation model name and
  endpoint, the chat-completions shape and the Anthropic Messages shape (`// UNVERIFIED:` in `moderation/remote.ts` and `prompt/llm.ts`).
- **Routes**: `GET /api/v1/models` (auth optional, `Cache-Control: private, max-age=30`): the catalog as `ModelDTO[]` (`Omit<ModelSpec, 'provider' | 'providerModel'>` plus `provider`, `available` from
  `isProviderAvailable`, `unavailableReason: 'not_configured'` when not; `limits.followsInputAspect` is passed through; the upstream model id never leaves the server), Demo models only while
  `ENABLE_MOCK_PROVIDER` is on, sorted available first, then images before videos, then by label. `GET /api/v1/tools` (auth optional, `public, max-age=300`): the four `ToolSpec`s. Both share the `catalog`
  budget of 240/min. `POST /api/v1/prompt/enhance` (auth required, 20/min per user in `prompt-enhance`, body <= 16 KiB): `{ prompt 1..2000, kind, locale? }` → `{ prompt, engine, translated }`; the draft is moderated
  first (422 `moderation_blocked`, `details.category`), so the enhancer cannot launder a blocked prompt.

## 7. HTTP API (v1) — summary

Base `/api/v1`. Auth: session cookie (UI) **or** `Authorization: Bearer avk_…` (developers). JSON envelope. Cursor pagination.

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| POST | `/auth/register` `/auth/login` `/auth/logout` | none (CSRF-checked: send `Origin`) | sets/clears cookie; 201/200/204 |
| POST | `/auth/logout-all` | session only | every device; 204 |
| GET | `/auth/me` | optional | `{data: UserDTO|null}`, never 401 |
| GET PATCH | `/account` | required | name, locale |
| POST | `/account/password` | session only | 204; wrong current password is 422 |
| GET | `/account/ledger` | required | paginated |
| GET POST | `/keys` · DELETE `/keys/:id` | session only | key returned once |
| GET | `/models` `/tools` | optional | availability + pricing; `limits.followsInputAspect` |
| POST | `/prompt/enhance` | required | 422 `moderation_blocked` for a blocked draft |
| POST | `/uploads` | required | multipart `file`; 201 `AssetDTO` |
| GET HEAD | `/media/:assetId` | optional | owner, or an output of a public generation of an enabled account |
| POST GET | `/generations` | required | `Idempotency-Key`; 201 (200 on replay); 402/429/503 |
| GET PATCH DELETE | `/generations/:id` | required | |
| POST | `/generations/:id/cancel` | required | |
| GET | `/explore` | none | public feed |
| GET | `/openapi.json` | none | not built yet (`account-docs`, from `public/openapi.json`) |
| GET | `/api/health` | none | bare (not enveloped) `HealthDTO` `{status:'ok', db:true, worker, version}`; `{status:'error', db:false, …}` with HTTP 503 when `SELECT 1` fails |

## 8. Generation lifecycle

```
POST /generations ─► validate ─► moderate ─► [tx: active limit + daily budget + debit + insert queued] ─► 201 GenerationDTO(status=queued)
worker: claim (queued→processing, lease) ─► mark "submit started" ─► provider.submit ─► sync outputs | async providerJobId (stored, marker cleared) ─► poll … ─► download/persist outputs
      ─► completeGeneration (processing→succeeded)           | any failure/timeout ─► failGeneration (→failed + refund)
cancel: queued|processing → canceled + refund (runner notices on next poll → provider.cancel best-effort)
crash: lease expires → requeueStale → queued (resumes polling if providerJobId present) or failed+refund after MAX_ATTEMPTS
       … but a PAID job with the "submit started" marker and no providerJobId → failed 'interrupted' + full refund, never re-submitted (the Demo provider just runs again)
```
Terminal states are final. Every transition is a compare-and-set on `(id, status[, workerId])`. Refunds are
idempotent. A succeeded job never gets refunded (except proportional partial output shortfall).

## 9. Security requirements (non-negotiable)

- Authz on every object access (owner or public flag); IDOR tests for generations/assets/keys.
- CSRF: SameSite=Lax cookie + Origin check on mutating cookie-auth requests.
- No user-supplied URLs fetched server-side except provider output URLs through `safeFetch`; uploads only via multipart.
- Secrets never reach the client bundle or logs; API keys & session tokens only stored hashed.
- Authz on assets: the owner, or an OUTPUT of a public generation whose owner's account is enabled (inputs are never shared; a disabled account's shared results are offline everywhere); a generation may start from the caller's own images only (uploads and own results, never videos).
- Rate limits (defaults): login 10/min per IP+email, register 5/h per IP, create generation 30/min per user, uploads 20/min, enhance 20/min, general 300/min (`route()` applies this one to every route that declares no `rateLimit`, see §6.1). Signed-in callers are keyed by account on every route; without a trusted proxy anonymous callers share one larger budget per route (§6.1, §16). The complete table is in §17.
- Cost protection: `DAILY_UPSTREAM_BUDGET_CREDITS` caps what can be committed to paid providers per rolling 24 h (§17); a paid job that may already be billing is never submitted twice (§6.6).
- Input limits everywhere (body size, prompt length, upload size/pixels). Output encoding handled by React; no `dangerouslySetInnerHTML` with user data.
- Security headers via `next.config.ts` (from `security/headers.ts`); media served with `nosniff`.

## 10. UI/UX requirements

- Dark-first creative aesthetic (deep indigo/ink background, violet→cyan brand gradient), full **light theme** via CSS variable tokens + toggle; both pass WCAG AA contrast. Brand: "AIVORE" wordmark + spark glyph (SVG in `public/`).
- Responsive mobile-first (360 px up), keyboard accessible, visible focus rings, `prefers-reduced-motion` respected, proper labels/aria, `aria-live` for generation status.
- Every list/screen has loading (skeleton), empty, and error states. Optimistic UI where safe.
- Arabic is a first-class language: RTL layout verified by screenshots; directional icons mirror; numerals follow locale.
- Studio: tool tabs, prompt box (+ enhance button, example prompts), model picker cards (badges, cost, availability), aspect-ratio chips with shape previews, count/duration/resolution controls, image dropzone (drag/drop/paste/click) for i2i & i2v, advanced (negative prompt, seed, strength), live cost + balance with insufficient-credits CTA, results canvas with progress placeholders, per-item actions (download, favorite, share toggle + copy link, reuse prompt, delete), keyboard shortcut ⌘/Ctrl+Enter.

## 11. Quality gates

`npm run typecheck && npm run lint && npm test && npm run build` must all pass at every phase boundary.
Scripts: `dev build start lint typecheck test test:watch test:e2e db:generate db:migrate worker admin format`.
Unit tests mirror `src/` under `tests/`. Tests never touch the network or the real filesystem outside temp dirs.

## 12. Foundation deliverables (checklist)

All seven items are done; §13 to §15 record what was built.

1. Tooling/config/deps installed (all deps up-front, incl. dev). `build`, `lint`, `typecheck`, `test` green on the skeleton.
2. `lib/*` kernel implemented + tested (`id`, `utils`, `errors`, `api-types`, `api-client`, `i18n` runtime, catalog types/pricing/aspect/index with empty model files, tools registry skeleton).
3. `server/*` kernel implemented + tested (`env`, `logger`, `db` + schema + first migration, `http`, `credits`).
4. Typed **stubs** (every public signature in §6, throwing `NotImplementedError` from `@/lib/errors`) for: auth, security, providers (types/errors/registry/http real types + empty mock), storage, uploads, generations, jobs, moderation, prompt — each stub file starts with `// OWNER: <key> — replace this stub`.
5. Test helpers: `tests/helpers/{db,http,factories}.ts` (in-memory DB, invoke route handlers with `Request`, create user/session/generation fixtures).
6. App shell: root layout (fonts, `<html lang dir>`, providers), placeholder `/`, `/api/health`, `instrumentation.ts` calling the (stub-safe) worker start.
7. Updated `docs/ARCHITECTURE.md` where reality differs.

## 13. Tooling facts (verified on the installed versions)

- **Versions**: Next 16.4 (Turbopack build), React 19.3, TypeScript 5.9, Tailwind 4.3, Vitest 5, ESLint **9** (not 10:
  `eslint-config-next`'s plugins do not support it yet), jsdom 29, Playwright 1.64, Drizzle ORM 0.45 / kit 0.31, zod 4.
- **Scripts that import `src/server/**`** (`db:migrate`, `worker`, `admin`, `db:generate`) run with
  `--conditions=react-server`, otherwise the real `server-only` package throws. `tsx` scripts also load `.env` then
  `.env.local` (missing files are fine). `drizzle-kit` resolves the `@/*` alias itself.
- **`typecheck`** runs `next typegen` first (generates `next-env.d.ts` and typed-route helpers, both git-ignored).
- **`gifenc`** is CommonJS with no types and exposes a different module shape per runtime (bundlers/Vitest: named
  exports; Node's native ESM loader used by `tsx`: only `default`). Import it **only** through `@/lib/gifenc`
  (ESLint forbids importing `gifenc` anywhere else); types live in `src/types/gifenc.d.ts`. `quantize` /
  `applyPalette` / `prequantize` view `rgba.buffer` as a whole `Uint32Array` and ignore `byteOffset`/`byteLength`; the `@/lib/gifenc` wrappers copy the pixels first whenever the view is not the whole buffer (pooled Node `Buffer`, subarray), so any `Uint8Array` / `Uint8ClampedArray` is safe (`prequantize` still rounds in place).
- **Vitest**: `globals` are off (import `describe/it/expect` from `vitest`); node environment by default, files named
  `*.dom.test.tsx` run under jsdom with `@testing-library/jest-dom` matchers and automatic cleanup. `tests/setup.ts`
  forces `DATABASE_PATH=:memory:`, `WORKER_MODE=off`, local storage in the OS temp dir and removes provider keys.
  `server-only` and `@/*` are aliased. Tests live under `tests/` only (Playwright specs live in `e2e/`).
- **Lint**: `export default` is an error except in Next-required files, `*.config.*`, `lib/i18n/messages/*.ts` and
  `src/types/**/*.d.ts`; `import type` is enforced; unused names must start with `_`.
- **Playwright**: the pre-installed Chromium (`/opt/pw-browsers/chromium-*`) is older than the one Playwright pins, so
  the config launches it via `executablePath` (override with `PW_CHROMIUM_PATH`, port with `PW_PORT`, default 3200).
  The web server is production mode with a scratch DB/media dir under the OS temp dir. Next loads `.env.local`/`.env` even in production mode, so the config blanks every key in `tests/helpers/isolated-env.ts` (provider keys, S3, `ADMIN_EMAILS`, `MODERATION_BLOCKLIST`) and pins `MODERATION_PROVIDER=none`, `PROMPT_ENHANCER=heuristic`, `TRUST_PROXY=false`; `tests/setup.ts` deletes the same keys for Vitest. E2E never reaches a real provider.
- **Standalone output**: `next build` emits `.next/standalone/server.js`; `better-sqlite3`, `sharp` and `gifenc` are
  traced into it once imported by server code. `next start` still works but prints a warning; Docker should run
  `node server.js` and copy `.next/static` and `public/` next to it.
- **Parallel previews**: never run `next dev/build/typegen` in the repo root while other agents may do the same (they share `.next`, and Next
  rewrites `tsconfig.json` when `distDir` is customised). Use `node scripts/preview.mjs <name> <port> [dev|start]`: it mirrors the working
  tree into `$TMPDIR/aivore-preview/<name>` (own `.next`, SQLite file, media dir, hardlinked `node_modules`), re-syncs every second and serves
  there. Edit in the real tree; the preview follows. Demo provider on, `.env.local` keys NOT copied unless `PREVIEW_WITH_ENV=1`.
- `next dev` may create an `AGENTS.md` at the repo root (Next's agent-rules feature, `agentRules` in `next.config.ts`).

## 14. Kernel facts (`lib/*` and `server/*` as built)

- **Import map**: everything in `src/server/**` starts with `import 'server-only'`. Use `@/server/db` (`getDb`, `createDb`, `withTx`,
  `Db`, `Tx`, `DbOrTx`, `schema`), `@/server/db/schema` (tables, row types), `@/server/db/migrate` (`runMigrations`),
  `@/server/env` (`getEnv`, `parseEnv`, `Env`, `EnvError`), `@/server/logger` (`getLogger`, `createLogger`, `redact`, `Logger`),
  `@/server/http/*`, `@/server/credits`.
- **Env**: `getEnv()` returns the zod output with the variable names as keys (`env.WORKER_CONCURRENCY`, `env.S3_BUCKET`, …). Blank
  values count as unset; booleans accept `true/false/1/0/yes/no/on/off`; numbers are range-checked integers; `ADMIN_EMAILS` is a
  lower-cased `string[]`, `MODERATION_BLOCKLIST` a `string[]`; `SESSION_SECRET` is never undefined (dev default + one warning
  outside production/test). Production requires `SESSION_SECRET` ≥ 32 chars and refuses the built-in default. Cross-field rules:
  `STORAGE_DRIVER=s3` needs bucket and keys; `PROMPT_ENHANCER=openai|anthropic` and `MODERATION_PROVIDER=openai` need their API
  key. All problems are reported together in one `EnvError` (`problems: string[]`). `TRUST_PROXY` (default false) was added, later `TRUSTED_PROXY_HOPS`, `RATE_LIMIT_DISABLED` (§16) and
  `DAILY_UPSTREAM_BUDGET_CREDITS` (integer 0..1e9, default 0 = off, §17).
  `resetEnvForTests()` forgets the memoized value.
- **Logger**: JSON lines (`time`, `level`, `msg`, fields). `debug/info` → stdout, `warn/error` → stderr. Level from `LOG_LEVEL`.
  Values under keys containing password, token (suffix), authorization, api key, secret, cookie, credential, signature or an
  `_KEY` suffix are replaced by `[REDACTED]`; `Bearer …` and `avk_…` inside strings are scrubbed; errors are serialized with
  stack/code/cause; cycles, binary data, bigint and very long strings are handled. Log an error as `log.error('msg', { err })`.
- **DB**: `getDb()` is a lazy singleton stored on `globalThis` (HMR-safe), opened at `DATABASE_PATH` with WAL, `busy_timeout` 5000,
  `foreign_keys ON`, then migrated. `withTx(dbOrTx, fn)` is the only way to write atomically: `BEGIN IMMEDIATE` on a `Db`, a savepoint
  on a `Tx`; `fn` must be synchronous (a returned Promise or un-executed query builder throws and rolls back). `runMigrations(db,
  { migrationsFolder? })` returns `{ applied, total }`, applies all pending SQL in one `BEGIN IMMEDIATE` transaction using
  drizzle's `__drizzle_migrations` bookkeeping (so several processes can start together; exactly one applies), and reads
  `<cwd>/drizzle` by default. `next.config.ts` (`outputFileTracingIncludes`) copies `drizzle/` into `.next/standalone/`; Docker must keep it next to
  `server.js`. `npm run db:migrate` (`scripts/migrate.ts`) runs the same code. A test fails when `schema.ts` and `drizzle/` drift.
- **Exports the kernel step fixed for `route()`** (all real since `auth-security`, §16): `server/auth` (`SessionUser`, `AuthContext`, `authenticate(req)`, exported from the `@/server/auth` barrel); `server/security/rate-limit.ts` →
  `RateLimitResult`, `RateLimiter`, `InMemoryRateLimiter`, `getRateLimiter()`, `setRateLimiter()`; `server/security/origin.ts` → `assertSameOrigin(req): void`; `server/security/ip.ts` →
  `getClientIp(req): string`, `UNKNOWN_IP`. `SESSION_COOKIE_NAME` is exported by `server/http/request.ts`. §15 lists which stubs remain (openai and replicate).
- **Test helpers** (`tests/helpers`; the HTTP, factory and fake helpers are described in §15): `db.ts` (`createTestDb({ file? })` → `{ db, path, close }`, fully migrated; `seedUser`; `freshDb()`),
  `credits.ts` (`ledgerInOrder`, `expectConsistentLedger` — the balance/chain invariants), `isolated-env.ts` (`ISOLATED_ENV_KEYS`), `model-spec.ts` (`modelSpecProblems(model)`: besides identity, tools, limits and the default request it prices EVERY request validation would accept — each count of an image model, each duration at each resolution of a video model — and enforces image `maxCount` 1-4;
  provider owners should assert it is `[]` for the models they add), and two child-process workers (`credits-race-worker.ts`,
  `migrate-worker.ts`) run with `node --import tsx --conditions=react-server`. better-sqlite3 is synchronous, so only separate
  processes can race; see `tests/server/credits/race.test.ts` for the pattern. Route tests mock `@/server/auth` and
  `@/server/security/*` (see `tests/server/http/route.test.ts`).

## 15. Stubs, test helpers and app shell (as built)

**Stub files (history).** The kernel step created each file below as `// OWNER: <key> — replace this stub` with the exact exports, throwing `NotImplementedError` from `@/lib/errors`. After the backend phase
EVERY row is real except `provider-openai` and `provider-replicate` (their `index.ts` still export a stub whose `isConfigured` is always false, so they offer no models). The table records who owns what.
Files marked *real* are finished wiring or contracts and carry a different `// OWNER:` header.

| Owner | Files |
| ----- | ----- |
| `auth-security` | all *real* (§16): `server/auth/**` (`tokens.ts` is the storage contract), `server/security/{origin,ip,ipaddr,rate-limit,ssrf,headers}.ts`, `scripts/admin.ts` (logic in `server/auth/admin/**`), `app/api/v1/{auth,account,keys}/**` |
| `providers-mock` | `server/providers/{types,errors,http,registry}.ts` (*real*), `server/providers/mock/**` (*real*, exports `mockProvider`, see §6.4; `isConfigured` is `env.ENABLE_MOCK_PROVIDER`) |
| `provider-fal` | *real* (§6.4 "fal provider, as built"): `server/providers/fal/**`, `lib/catalog/models/fal.ts` |
| `provider-openai`, `provider-replicate` | `server/providers/{openai,replicate}/index.ts` are still stubs exporting `openaiProvider`, `replicateProvider` (`isConfigured` is always false) |
| `storage` | all *real* (§6.5 "Storage and uploads, as built"): `server/storage/**`, `server/uploads/**`, `app/api/v1/{uploads,media}/**` |
| `engine` | all *real* (see §6.6 "Engine, as built"): `server/generations/{service,lifecycle,queries,list,idempotency,dto,budget,paid}.ts`, `server/jobs/{runner,job-run,input,outputs,backoff,failure,runtime,wake,worker,start}.ts`, `instrumentation.ts`, `scripts/worker.ts`, `app/api/v1/{generations,explore}/**` |
| `catalog` | all *real* (§6.7): `server/moderation/**`, `server/prompt/**`, `lib/validation/**`, `lib/tools/**`, `app/api/v1/{models,tools,prompt}/**` |

**Test helpers** (`tests/helpers`, import with relative paths):
- `db.ts`: `createTestDb({ file? })`, `seedUser`, and `freshDb()`, which registers `beforeEach`/`afterEach` hooks so code that calls `getDb()` itself
  (services, routes) gets a fresh migrated in-memory database per test; read `.db` inside tests. (Not named `use…` because ESLint treats that as a React hook.)
- `http.ts`: `invokeRoute(handler, { method?, url?, query?, headers?, body?, params? })` → `{ status, headers, json, text, response }`. It builds a real `Request`
  against `APP_URL`, sends plain bodies as JSON (strings, `Uint8Array` and `FormData` untouched) and passes `params` as a promise like Next.js. Nothing is mocked.
- `factories.ts`: `createUser(db, overrides?)` (50 credits, emails lowercased), `createSession(db, userId, opts?)` → `{ id, token, cookie, headers: { cookie, origin }, expiresAt, row }`
  (inserted directly with `hashToken`, so it authenticates as soon as auth exists; `headers` includes an `Origin` equal to `APP_URL` so mutating calls pass the CSRF check),
  `createUserWithSession`, `createGeneration(db, { userId, … })` (queued Demo generation; kind follows `tool`; does not debit credits), `createAsset(db, { userId, … })`.
  It also re-exports the fakes below.
- `fakes.ts`: `fakeStorage({ signedUrls? })` (in-memory `StorageDriver` that enforces the key rules, `not_found`, inclusive ranges), `fakeProvider(options?)`
  (`vi.fn` methods; defaults to `count` tiny decodable outputs, scriptable `submit`/`poll`/`cancel`/`configured`), `fakeProviderContext(overrides?)` (silent logger, test env,
  a `fetch` that fails unless you stub it), `tinyOutput`, `TINY_PNG`, `TINY_GIF`, `streamToBytes`. Inject with `setProviderOverrides({ mock: fakeProvider() })` and `setStorageOverride(fakeStorage())`.

**App shell.**
- `app/layout.tsx` is async: `<html lang dir data-theme>` come from `getI18n()` (cookie `aivore_locale`, then `Accept-Language`, then `ar`) and `getTheme()` (cookie `aivore_theme`:
  `light | dark | system`, default `dark`; `lib/theme.ts` has the constants and `serializeThemeCookie`). Rendering the theme on the server means no inline script and no flash; it also makes every page
  dynamic. It provides `I18nProvider`, a localized skip link (`common.a11y.skipToContent`) and `generateMetadata`/`viewport`: `metadataBase` is the origin of `APP_URL` (`lib/site-url.ts`
  `metadataBaseFor`, undefined for anything that is not an http(s) URL, so a bad value cannot break every page's metadata), and `viewport.themeColor` is `THEME_COLORS` of `lib/theme.ts`
  (`dark #0b0b16`, `light #f6f6fb`, equal to each theme's `--background` token; a test keeps them in step). `<html>` also carries `data-scroll-behavior="smooth"`: globals.css sets
  `scroll-behavior: smooth`, and this attribute is how Next is told that is intended (it then switches it off for the instant of a route change instead of warning). **Every page or layout must render exactly one
  `<main id="main-content">`**, the skip link's target. Theme and locale switchers write the cookies and refresh.
- `app/globals.css` (ui-kit extends it): imports Tailwind and the self-hosted `@fontsource-variable/{inter,cairo}` (families `Inter Variable`, `Cairo Variable`; the build emits woff2 per unicode-range
  subset, including `cairo-arabic`), defines `--background/--foreground/--muted/--ring` for `:root[data-theme=dark|light]` and `data-theme=system` (via `prefers-color-scheme`) and maps them to
  Tailwind colors (`bg-background`, `text-foreground`, `text-muted`). Arabic pages get Cairo first: the font stack is the custom property `--font-family-base` (Inter first; Cairo first under `:root[lang='ar']`), `--font-sans` points at it and
  Tailwind's preflight uses it for `html`, so `body` and the `font-sans` utility inherit the right order (never put a literal font list on `body`: a class there would shadow the `html` rule and mix two fonts in Arabic text).
  The `dark:` variant is redefined with `@custom-variant dark` to follow `<html data-theme>` (`dark`: always, `system`: under `prefers-color-scheme: dark`, `light`: never) instead of Tailwind's OS-only default; prefer the token classes where possible.
  `tests/app/globals-css.test.ts` compiles the real stylesheet and asserts both.
- `app/(marketing)/page.tsx` is the placeholder landing page (name and tagline in the active locale). `src/app/page.tsx` no longer exists; ui-kit replaces the placeholder in place.
- `app/api/health/route.ts` (real): bare `HealthDTO`, `SELECT 1` against the database, `worker` = `WORKER_MODE`, `version` from `lib/version.ts` (package.json inlined at build time). 503 when the database fails. Opted out of the general rate limit (`rateLimit: false`): probes must never be throttled.
- `instrumentation.ts` (real): in the Node.js runtime with `WORKER_MODE=inline` it dynamic-imports `server/jobs/start` and calls `startWorker()`; any failure (bad env, stub runner) is logged at error
  and swallowed, so the app always boots. Verified: with the stub runner and `WORKER_MODE=inline` the server logged the `NotImplementedError` and still served `/` and `/api/health`.
- Verified on the production build: `/api/health` returns `{"status":"ok","db":true,"worker":"off","version":"0.1.0"}`; `/` renders `<html lang="ar" dir="rtl">` for `Accept-Language: ar` or no header,
  `lang="en" dir="ltr"` for `en`, a locale cookie beats the header, and `aivore_theme=light` renders `data-theme="light"`.

**UI kit (owner `ui-kit`, as built).**
- **Tokens** (`app/globals.css`): per theme (`dark` default, `light`, and `system` = the light block under `prefers-color-scheme: light`, kept identical to `light` by a test) the surfaces `--background / --surface /
  --surface-raised / --surface-overlay`, lines `--border / --border-strong / --field-border` (3:1 outline of form controls), text `--foreground / --muted / --subtle`, brand `--primary` (fill, white text),
  `--brand` (violet text/icons), `--brand-from → --brand-to` (violet → cyan, decoration only, never behind text), `--accent`, `--ring`, status `--success / --warning / --danger / --info` (+ `-soft` tints,
  `--danger-solid`) and depth `--elev-* / --scrim`. Tailwind classes: `bg-background|surface|surface-raised|surface-overlay`, `text-foreground|muted|subtle|brand|accent|success|warning|danger|info`,
  `border-border|border-strong|field`, `bg-primary text-primary-foreground`, `bg-*-soft`, `shadow-xs…lg|glow`, radii `rounded-sm…3xl`. Brand utilities: `text-gradient-brand`, `bg-brand-gradient`, `bg-primary-gradient`,
  `border-gradient-brand`, `glow-brand`, `surface-glass`, `bg-aurora`, `bg-dots`, `bg-shimmer`, `no-scrollbar`. Animations: `animate-fade-in|fade-out|slide-up|scale-in|scale-out|slide-in-start|slide-in-end|slide-in-bottom|toast-in|toast-out|shimmer|pulse-soft|spinner|indeterminate|bump`.
  `prefers-reduced-motion` collapses all transitions/animations (the spinner and indeterminate bar fall back to a slow fade). **`tests/components/tokens.test.ts` asserts WCAG AA for every text/background pair in both themes** (4.5:1 text, 3:1 control outlines and focus ring): change a colour and run it.
  Do not write both `backdrop-filter` and `-webkit-backdrop-filter` in one rule: lightningcss then drops the unprefixed one.
- **Direction.** `--flow` is +1 in LTR and -1 in RTL (`translateX(calc(var(--flow) * …))`), `--brand-angle` mirrors gradients. Use logical utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start`); flip
  arrow icons with `<Directional>` or `rtl:-scale-x-100`. Arabic never gets letter-spacing (`:root[lang='ar'] *`), so never rely on `tracking-*` for Arabic. Components decide direction at event time from the DOM
  (`isRtl(el)`: nearest `[dir]`), never from props: horizontal arrow keys in Tabs, RadioGroup/SegmentedControl and Slider follow what the user sees (RTL: ArrowLeft = next), menus and tooltips place themselves by inline start/end.
- **Primitives** — `import { … } from '@/components/ui'` (barrel; each file is also importable directly): `Button` (+ pure `buttonVariants`/`ButtonVariant` from `ui/button-variants`, usable from server components to style a `Link`;
  `Button` itself is a client component: `href` renders Next `Link` or a plain `<a>` for external URLs, `loading` = `aria-busy` + clicks ignored while staying focusable), `IconButton` (`label` required, tooltip by default),
  `Input` (adornments), `Textarea` (`autoGrow`, `showCount`+`maxLength`), `Select` (native), `Switch`, `Checkbox`, `RadioGroup` (`options`, `appearance="list|card"`), `SegmentedControl`, `Slider`, `Tabs/TabsList/TabsTrigger/TabsContent`,
  `Dialog` (`role="alertdialog"`, `dismissible={false}` for confirmations), `Sheet` (`side="start|end|bottom"`), `DropdownMenu` (+ `Item`, `Label`, `Separator`, `RadioGroup`, `RadioItem`), `Tooltip`, `Toaster` + `toast` / `useToast()`,
  `Badge`, `Card*`, `Skeleton`, `SkeletonText`, `Spinner`, `Progress`, `Avatar`, `Kbd`, `Separator`, `EmptyState`, `ErrorState` (maps an error's code to `errors.<code>`), `Field` + `FormError`, `Logo`, `Directional`, `errorMessage(t, error)`.
  `Field` wires label, hint and error to the control through context: `Input/Textarea/Select/Checkbox/Switch` inside a `Field` get the id, `aria-describedby`, `aria-invalid` and `required` automatically.
  Modals (`Dialog`, `Sheet`) trap Tab, close on Escape and backdrop click, lock page scroll, make the rest of `<body>` `inert` (except `[data-inert-exempt]`, the toast region) and return focus on close; a menu inside a modal closes on
  its own Escape first. Stacked modals: only the one on top reacts to Escape (a module-level stack in `modal.tsx`; a `dismissible={false}` confirmation on top swallows it, so the modal beneath stays open); the ones below are `inert`, so Tab never leaves the top one.
  The setup (scroll lock, inert background, initial focus) follows the portal's elements through state, so a modal that is `open` on the very first render (server-rendered or URL-driven) is set up as soon as it hydrates. `getTabbable` skips controls the CSS hides (`display: none`, `visibility: hidden`), so a hidden first or last action (`hidden sm:inline-flex`) cannot break the Tab wrap-around.
  `toast` is a module-level store: call `toast.success('…')` from anywhere, one `<Toaster/>` per layout renders it (info/success/warning in a polite live region, errors in an assertive one; the countdown pauses on hover and focus). The regions and the toasts are plain `div`s (`role="status"|"alert"` replace a list's role, so a list inside would be invalid ARIA).
  Reusing an `id` replaces the toast in place and restarts its countdown (`ToastRecord.serial` changes on every call), so a progress toast (`duration: Infinity`) that turns into its result keeps the result for its whole duration.
  `DropdownMenu` opens on its first item when activated from the keyboard (`click.detail === 0`: Enter, Space) so a focus ring is visible, and on the menu itself for a pointer click; a link item (`href`) keeps `id`, `title`, `aria-*` and `data-*` props. The radius scale is generous (`--radius-md` is 10px): boxes of about 20px (`Checkbox`, `Kbd`) use `rounded-sm`, or a checkbox turns into a radio-looking circle.
  The selected `SegmentedControl` segment and the selected pills `Tabs` trigger have a `ring-field` edge (3:1) besides their lighter fill: every light-theme surface is white, so the fill alone does not show the selection. `Tabs` without any `TabsContent` leaves `aria-controls` pointing at a panel that does not exist on the selected tab: render a panel (or use `SegmentedControl` for a plain filter).
  **Public pages outside `(marketing)` (e.g. `explore`, `s/[id]`) must mount their own `<Toaster/>`** — wrapping them in `SiteChrome` does it.
  **Touch targets.** The small control sizes grow to 44px on touch screens through Tailwind's `pointer-coarse:` variant (`Button` sm/md, `IconButton` sm/md, `Input`/`Select`/`Textarea` sm/md, `SegmentedControl`, pills `Tabs`, the account avatar, the credits chip, the header and footer links), so a mouse keeps the compact sizes. A control that must not look bigger (`Switch`, logo links, the copy button, the auth switch link) uses the `hit-area` utility instead: an invisible `::after` layer, centred, at least 44px both ways, only under `(pointer: coarse)`. When you build a new small control, pick one of the two. `edge-fade` masks both ends of a row that scrolls sideways below `sm` (the hero's jump links). `tests/components/ui/touch-targets.layout.test.tsx` measures all of this in Chromium with a touch context (`openPage(..., { touch: true })`).
  `CardTitle` takes `as="h2" | "h3" | "h4"` (default `h3`): pick the level that follows the heading above the card, or axe flags the page's heading order. Overlays on artwork (the landing's sample captions) carry their own scrim as tall as the text and must keep 4.5:1 against the worst 5% of the pixels behind them (`tests/components/marketing/landing.layout.test.tsx` measures it); a grid item that is itself a `grid` needs `content-start`, otherwise spare height is shared between its rows and titles drift out of line across columns.
- **Layout** (`components/layout`): `SiteHeader`, `SiteFooter`, `SiteChrome` (server: resolves the optional user, provides `UserProvider`, header + page + footer + `Toaster`; **the page renders its own
  `<main id="main-content">`**, as the landing placeholder does), `AppShell` (client; `initialUser`, `defaultCollapsed`; sidebar on `lg`, bottom tab bar below; it renders the one `<main id="main-content">`, the `UserProvider` and the `Toaster`),
  `LocaleSwitcher`, `ThemeToggle`, `UserMenu({ navigation?, preferences? })`, `CreditsChip`, `RedirectToLogin`. The sidebar state lives in the cookie `aivore_sidebar` (`collapsed|expanded`, read by `(app)/layout`). Locale and theme switchers write
  `aivore_locale` / `aivore_theme` with the `lib/i18n` / `lib/theme` helpers and call `router.refresh()` (the theme attribute is also applied immediately).
  `SiteHeader` shows the inline navigation, the switchers and Log in from `lg` (1024px); below it (phones and portrait tablets, where the longer Arabic labels do not fit one row) only Sign up and the menu button show and everything else lives in the sheet menu. `UserMenu`'s trigger is named by hidden text and the avatar is `aria-hidden`: an `aria-label` that omits the visible initials fails axe's label-in-name rule.
  Route groups: `(marketing)/layout` = `SiteChrome`; `(auth)/layout` = branded backdrop + centered card + the one `<main>` (auth pages render only the card's content); `(app)/layout` = `AppShell` (it renders the `<main>`: **pages under `(app)` must not render their own**).
- **Auth guard** (`src/lib/auth-guard.ts`, server-only; `src/lib/next-path.ts`, isomorphic). Layouts cannot know the request path, so **every `(app)` page starts with `const user = await requireUser('/its/own/path')`** (use the real path, e.g.
  `` `/gallery/${id}` ``): a visitor is redirected on the server to `/login?next=<path>`. `(app)/layout` is only the safety net: with no user it renders `<RedirectToLogin/>` (client redirect that adds `?next=` from the browser URL) instead of the page, so
  content is never shown to a visitor. `getOptionalUser()` is for places where a visitor is fine (marketing). One lookup per request (`React.cache`). A failing `getCurrentUser()` is logged and treated as "no user" **only when `NODE_ENV === 'development'`**; in production
  and tests it throws. (History: **only in development**, while auth was still the unimplemented stub (`NotImplementedError`), `requireUser`/`getAppUser` returned `PREVIEW_USER` (`preview@aivore.local`, 50 credits) so the shell and pages could be
  previewed before auth landed; auth is real now, so that branch no longer triggers.) The marketing side sees "no user" for a visitor. Login/register pages should send the user on with `safeNextPath(searchParams.next)` (only same-site absolute paths pass; never `/login|/register`) and `loginUrl(path)` builds the redirect.
- **`useUser()`** (`src/lib/user-context.tsx`, client; `UserProvider initialUser` is mounted by `AppShell` and `SiteChrome`): `{ user: CurrentUser | null, creditBalance, refresh(), setCreditBalance(n) }`. `refresh()` calls `GET /api/v1/auth/me`
  (deduplicated, never rejects; 401 or `{data:null}` clears the user; other failures keep the current values) and also runs when the tab becomes visible after 60 s. Call `refresh()` (or `setCreditBalance(n)` when the response already carries the balance)
  after anything that spends or grants credits. A new server value (after `router.refresh()`) replaces local state only when it differs.
- **Brand assets**: `public/logo.svg` (lockup, wordmark follows `prefers-color-scheme`), `public/icon.svg`, `public/icon-192.png|icon-512.png|icon-maskable-512.png`, `src/app/{icon.svg,favicon.ico,apple-icon.png,opengraph-image.png (+ .alt.txt),manifest.ts}`;
  `<Logo variant="full|glyph" label={null}>` is the inline version (gradient from the theme tokens, unique ids per instance).
- **i18n** added keys: `common.{a11y,nav.docsShort,credits,user,states,form,toast}`, `landing.footer`, `auth.{login,register,fields,hints,errors,password,guard,layout}` (the log in / register pages that use most of them are still to come).
- Tests: `tests/components/**` (jsdom `*.dom.test.tsx` per primitive and layout piece: keyboard, aria, RTL; node tests for tokens, auth guard, next-path, server layouts). `tests/components/render.tsx` (`renderUi(ui, { locale })`) wraps in the i18n provider and sets `<html dir>`.
  `tests/components/axe.ts` runs axe-core in jsdom (`axe-core` is a devDependency now; no layout there, so contrast is covered by `tokens.test.ts`). `tests/components/browser.ts` + the `*.layout.test.tsx` files run the real compiled stylesheet and fonts in the pre-installed Chromium (`openPage(browser, markup, { locale, theme, width })`; `renderToStaticMarkup` of the component, routes intercepted, no server): header width sweep 320-1100px in ar/en, computed radii and selection edges, axe with real layout. They skip themselves when no Chromium is installed (`PW_CHROMIUM_PATH`, `/opt/pw-browsers`). jsdom's `querySelector('#id')` misses elements when the document holds the same id twice, so tests must not render the same fixture id twice.

## 16. Auth & security (as built, owner `auth-security`)

Code: `server/auth/**`, `server/security/**`, `app/api/v1/{auth,account,keys}/**`, `scripts/admin.ts` (logic in `server/auth/admin/**`).
Everything below is covered by tests under `tests/server/{auth,security}` and `tests/app/api/v1/{auth,account,keys}`.

**Passwords** (`auth/password.ts`). `node:crypto` scrypt, N=2^15, r=8, p=2, 64-byte key, 16-byte salt, stored as `scrypt$N$r$p$<salt>$<hash>` (base64url). The parameters travel inside the
hash, so `verifyPassword` uses the ones stored (bounded: N a power of two in 2^14..2^20, so a damaged row cannot exhaust memory), `needsRehash(hash)` flags weaker or unreadable hashes and
`loginUser` upgrades them after a successful login. Input is NFKC-normalized before hashing (Arabic presentation forms, full-width Latin), compared with `timingSafeEqual`, and anything over
1024 characters is refused unhashed. scrypt runs on libuv's pool, so at most 3 derivations run at once and at most 64 wait; beyond that `hashPassword`/`verifyPassword` throw 429 `rate_limited`
("busy"). `verifyAgainstDummy(password)` spends one real verification against a per-process dummy hash: login calls it for unknown emails so "no such account" and "wrong password" cost the same
(tested by counting scrypt calls). Policy (`assertPasswordPolicy(password, { email? })`, 422 `validation_failed` with one issue at path `password`): 8..128 characters (code points), not in the
built-in deny list (`common-passwords.ts`, about 150 entries incl. Arabic and product-specific ones), not one repeated character, not the account's own email.

**Sessions** (`sessions.ts`, `cookies.ts`). Token = `generateToken()` (32 random bytes, base64url, 43 chars); the database stores `hashToken(token)` (HMAC-SHA256 keyed with SESSION_SECRET), so a stolen database is
useless without the secret and the lookup key reveals nothing guessable. Lifetime 30 days, sliding: a session used again after 1 hour gets a fresh 30 days (`lastSeenAt` and `expiresAt` are written at
most hourly), capped at 180 days after login. At most 20 sessions per user (least recently used dropped); expired rows are deleted when met and, at most hourly, in bulk. Cookie `aivore_session`:
`HttpOnly; SameSite=Lax; Path=/; Expires/Max-Age`, plus `Secure` whenever `NODE_ENV=production` (production must be served over HTTPS; browsers also accept it on `http://localhost`). **The cookie is issued once, at login or
registration, and lives until the session's absolute cap** (`sessionCookieExpiry(createdAt)` = login + 180 days), it is never re-sent: the sliding 30 day idle expiry is enforced by the database alone (an idle, expired or revoked session
is refused whatever the browser still holds). Re-sending the cookie when the hourly touch happens cannot work: whichever request comes first after the hour (a server component, any API call) consumes the "refreshed" flag, and a server
component cannot set cookies, so an active user's cookie would still vanish on day 30. `logout(token)`,
`logoutAll(userId)`, `changePassword(userId, current, next, keepSessionId?)` (revokes every other session, keeps API keys). `authenticate(req)`: a `Bearer avk_…` header is authoritative (a wrong key is
anonymous even with a good cookie), otherwise the cookie; disabled users and expired sessions give null. **Additive `AuthContext` fields** `sessionExpiresAt?` (when the database session now ends) and `sessionRefreshed?`
(this request extended it); informational only, nothing sets a cookie from them. `getCurrentUser()` extends the database row the same way.

**API keys** (`api-keys.ts`). `avk_<8 chars [a-z0-9]>_<43 chars base64url>`; only `hashToken(fullKey)` and the display prefix `avk_xxxxxxxx` are stored; the full key is returned once by `POST /keys`.
At most 20 active (unrevoked) keys per user (409 `conflict`, counted in the insert's transaction). `revokeApiKey` answers 404 for a key that is missing or someone else's (same body), and is idempotent.
`lastUsedAt` is written at most every 5 minutes. `listApiKeys` / `GET /keys` return EVERY active key plus the most recently created revoked ones, 100 rows at most, newest first (revoked keys are kept for the audit
trail but can never push a live key out of the list, so it can always be found and revoked); `nextCursor` is always null. **Key management (`/keys*`), `POST /account/password` and `POST /auth/logout-all` accept a browser session only** (403 for API keys): a leaked key cannot
mint more keys or lock the owner out. `GET /account`, `PATCH /account`, `GET /account/ledger` accept both.

**Registration and login** (`users.ts`). `registerUser` validates (email: lower-cased ASCII `z.email()` up to 254; name: 1..80 printable characters with at least one visible one (zero-width spaces, soft hyphens, Hangul fillers, the blank braille pattern and bare marks do not count; ZWNJ/ZWJ/LRM/RLM stay allowed inside text), NFC, no control or bidi-override characters;
password policy), hashes, and then ONE synchronous transaction creates the user, grants `SIGNUP_BONUS_CREDITS` through `credits.grantCredits` (`signup_bonus`, idempotency key `signup_bonus:<userId>`) and opens
the session; any failure rolls all three back (tested by failing after each write). `SIGNUP_ENABLED=false` → 403 `signup_disabled`. `provisionUser(...)` is the same without a session (used by the CLI).
- *Duplicate emails.* A taken email is a 409 `conflict` with the message "This account could not be created with these details" (no field named, no details). The status itself reveals existence and
  that cannot be hidden without email verification, so enumeration is made expensive instead: 5 registrations per hour and address (failed attempts count, cross-site refusals do not), the password is hashed BEFORE the duplicate check
  (a taken email costs as much time as a new one) and the UI shows its own text for `conflict` on this form. Login never reveals anything: a wrong password, an unknown email and a malformed email give the
  identical 401 `unauthorized` "Invalid email or password" after the same single scrypt run (the shared dummy hash is made on first use and a refused attempt is never remembered, otherwise one burst at start-up would leave unknown emails answering 429 while known ones answer 401). A disabled account gets 403 `forbidden` only after the right password was given. `loginUser` limits 10 attempts per
  minute per IP **and email** on top of the route's 10 per minute per IP.
- *`ADMIN_EMAILS`.* An address in the list becomes `role=admin` **at registration only**, and **emails are not verified**: whoever registers such an address first owns the admin account. Register the admins
  right after deploying (once the account exists nobody else can take the address) or create them with `npm run admin -- create-user --role admin`. A warning naming this is logged at start-up (from the first
  `getEnv()`) whenever the variable is set.
- Changing the password: wrong current password is 422 at path `currentPassword` (not 401: the user is signed in), the new one must pass the policy and differ.

**Routes** (all via `route()`, all `Cache-Control: no-store`; limits are per client address unless noted, see "Client address" for what that means behind no proxy):

| Route | Auth | Limit | Notes |
| ----- | ---- | ----- | ----- |
| `POST /auth/register` | none, `csrf: true` | 5 / hour / IP; address unknown: 60 / hour shared | 201 `UserDTO`; sets `aivore_session` and `aivore_locale` (body locale, else `Accept-Language`, else `ar`); revokes the session it arrived with |
| `POST /auth/login` | none, `csrf: true` | 10 / min / IP (+10 / min / IP+email inside); address unknown: only the 10 / min / email inside | 200 `UserDTO`; new token every time and the presented one is revoked (no session fixation); locale cookie = the account's |
| `POST /auth/logout` | none, `csrf: true` | 30 / min / IP; address unknown: none | 204 + expired cookie; idempotent; reads the cookie itself so stale sessions can always be cleaned up |
| `POST /auth/logout-all` | session | 10 / min / user | 204; every device (**added route**) |
| `GET /auth/me` | optional | 120 / min / user (IP when anonymous); address unknown: 1200 / min | `{data: UserDTO}` or `{data: null}`, never 401; never touches the cookie |
| `GET /account` · `PATCH /account` | required | 60 · 20 / min / user | PATCH `{name?, locale?}` only (unknown keys ignored), a locale change also sets the locale cookie |
| `POST /account/password` | session | 5 / min / user | 204 |
| `GET /account/ledger` | required | 60 / min / user | `?limit&cursor`, `credits.listLedger`, `Page<LedgerEntryDTO>` |
| `GET /keys` · `POST /keys` · `DELETE /keys/:id` | session | 60 · 10 · 10 / min / user | list is `Page<ApiKeyDTO>` (never the secret); POST 201 `{key, record}`; DELETE 204 |

The three IP-keyed credential routes and `/auth/me` are built with `addressRoute` (`server/auth/address-route.ts`, a thin layer over `route()`): it picks the per-address budget or the "address unknown" budget per request, and for `csrf: true` routes it runs the
same-origin check BEFORE any budget is spent, so a request refused as cross-site (a hostile page firing forms at a visitor) never uses up the visitor's login or sign-up allowance.

Auth bodies are capped at 8 KiB. Non-browser clients that sign in with a password must send `Origin: <APP_URL>` (login and register are CSRF-checked because no session exists yet to trigger the check).

**CSRF** (`security/origin.ts`). `route()` calls `assertSameOrigin` for mutating methods when the request is cookie-authenticated (or `csrf: true`). Safe methods are exempt. Otherwise `Origin` must be `APP_URL`'s origin or the
origin the browser used (`Host`; `X-Forwarded-Host`/`-Proto` only with TRUST_PROXY): a page on another site cannot forge either. Without `Origin` the `Referer` is used; with neither the request is refused unless it carries
`Authorization: Bearer avk_…`. `Origin: null`, garbage and `Sec-Fetch-Site: cross-site` are always refused.

**Client address** (`security/ip.ts`). Next.js 16 does not expose the socket address to route handlers (it only fills `X-Forwarded-For` when the client sent none, which cannot be told apart from a spoofed one), so with
`TRUST_PROXY=false` the result is `req.ip` if a platform provides it, otherwise `'unknown'`, meaning "this app cannot tell its clients apart" (a production start-up warning says so). Behind a reverse proxy set
`TRUST_PROXY=true`: the client is the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` (default 1) positions from the RIGHT (the left part is client-controlled); invalid values give `'unknown'`. **Only `X-Forwarded-For` is read.**
Next.js fills it with the socket address, i.e. the proxy's own, when the proxy sent none, so an `X-Real-IP` fallback could never be reached in production (and the header is client-controlled unless the proxy overwrites it): a proxy that
only sets `X-Real-IP` would put every client into the proxy's single bucket, so configure it to append to `X-Forwarded-For` (nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, Caddy and Traefik do by default).
Ports and brackets are stripped, IPv4-mapped IPv6 becomes IPv4, and IPv6 collapses to its /64 (`2001:db8:1:2::/64`) so one subscriber cannot rotate through billions of addresses.

*Without a trusted proxy every visitor is the one address `unknown`.* A per-address budget sized for one client would then be a switch anybody can pull for everybody (11 failed logins a minute and nobody signs in), so the credential
routes treat that case on purpose: **login** has no address-wide budget (what remains is the 10 / min per EMAIL inside `loginUser`, which bounds guessing against one account but also lets someone lock that one account out for a minute,
and the password hash gate, which caps concurrent scrypt work), **logout** has none (one indexed delete), **register** has a shared 60 / hour (it caps how many free-credit accounts one hour can mint: 60 times `SIGNUP_BONUS_CREDITS`),
**/auth/me** a shared 1200 / min for anonymous callers, and the public **/explore** feed (engine module) the same 1200 / min instead of its 60 / min per address. Everything keyed by user (keys, account, logout-all) is unaffected.
**Every other route** (`route()` itself, hardening module; §6.1): a signed-in caller (cookie or API key, resolved even on `optional` routes such as `/models` and `/tools`) is keyed by account and never spends an anonymous bucket;
anonymous callers of a route that leaves `by` unset share one `<route class>:anonymous-unknown` bucket of `ANONYMOUS_UNKNOWN_FACTOR` (10) times its limit (catalog 2400/min, general 3000/min, one bucket per class), so a script can exhaust
the anonymous budget of a class (anonymous visitors then get 429 there) but can never starve a signed-in user; a spoofed `X-Forwarded-For`/`X-Real-IP` is ignored and neither buys a fresh bucket nor frames another address. Before this,
1000 anonymous `GET /models` made the next signed-in `GET /models` a 429 for the whole site. Anonymous traffic with forged cookies or keys counts as anonymous. The media route counts anonymous unknown-address viewers not at all (§6.5).
The real fix for per-client limits is still a proxy with `TRUST_PROXY=true`. In production the server logs ONE warning per process (`all clients share one rate-limit bucket ... set TRUST_PROXY=true behind your proxy`) the first time a request
carries `X-Forwarded-For` or `X-Real-IP` while `TRUST_PROXY=false` (Next.js fills `X-Forwarded-For` with the socket address itself, so the hint also appears on a server reached directly; ignore it there), next to the start-up
warning of `getEnv()`. Security-critical limits stay keyed on the target as well: login on the email (10/min, inside `loginUser`), so one attacker cannot lock everybody out, only the one account he is guessing.

**Rate limiter** (`security/rate-limit.ts`). Same interface, fixed windows; additionally the key table is capped (100 000 keys, least recently used evicted, so a flood of unique keys cannot grow memory or reset the counter
of a client that keeps hitting), expired windows are swept lazily, and a window further away than its own length (clock stepped back) restarts. State is per process. `RATE_LIMIT_DISABLED=true` makes `getRateLimiter()`
return a pass-through limiter (a limiter installed with `setRateLimiter` still wins); it exists ONLY so e2e/load tests can create many users from one address and logs a loud warning at start-up.

**SSRF** (`security/ssrf.ts`). `assertPublicHttpsUrl(url)` accepts `https:` on port 443 only, no credentials, no `localhost`/`.local`/`.internal`/`.lan` names, resolves the name and requires EVERY answer to be public. Public
means: IPv4 outside 0/8, 10/8, 100.64/10 (CGNAT, Alibaba metadata), 127/8, 169.254/16 (cloud metadata), 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4 (multicast) and 240/4 (reserved, broadcast); IPv6 only inside
2000::/3 minus 2001::/23 (Teredo, ORCHID), 2001:db8::/32, 2002::/16 (6to4) and 3fff::/20, so loopback, link-local, unique-local, multicast, NAT64 and IPv4-compatible are out; IPv4-mapped IPv6 is judged by the IPv4 inside. `safeFetch`
validates every hop, then again **at connect time** through a custom `lookup` on the socket (the checked answer is the connected one, so DNS rebinding between "validate" and "connect" cannot work; IP literals are checked before
connecting because Node does not call `lookup` for them), follows at most 3 redirects by hand (each re-validated; a redirect to `file:`, `ftp:`, an internal name or a private address is a 400), sends `Accept-Encoding: identity` and
refuses compressed answers, checks the `Content-Type` allowlist (exact or `image/*`; `*/*` opts into anything, a missing type is refused unless `*/*`) before reading, enforces `maxBytes` on `Content-Length` and while streaming, and
covers the whole download (redirects and body) with `timeoutMs`. Errors are `AppError`s and never contain the URL (it may carry a signed token): `bad_request` (URL not allowed, too many redirects), `payload_too_large`,
`unsupported_media_type`, `provider_error` (non-2xx, timeout, network). If the caller's `signal` aborts, its reason is rethrown untouched. Test seams: `SafeFetchOptions.allowHttpForTests` (also accepts `http:`, any port and
loopback, nothing else) and `setSsrfResolverForTests(fn | null)`; production code must not use either.

**Headers** (`security/headers.ts`, still free of imports because `next.config.ts` loads it). CSP: `default-src 'self'`, scripts `'self' 'unsafe-inline'` (a static header cannot carry a nonce; `'unsafe-eval'` in development only),
no frames, objects or foreign base/form targets, `frame-ancestors 'none'`; HSTS in production; `Permissions-Policy` switches off camera, microphone, geolocation, payment, USB, serial, HID, MIDI, display capture, sensors and
Topics (`bluetooth` was removed: it is not a Permissions-Policy feature and Chrome logged "Unrecognized feature" on every page; a test only allows directives it knows); `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `COOP: same-origin`.

**Admin CLI** (`npm run admin -- <command>`, `scripts/admin.ts` → `server/auth/admin/cli.ts`). `create-user`, `grant-credits`, `set-role`, `disable` (also signs the user out everywhere and takes everything the account shared offline: feed, share page and media URLs; `enable` brings the results back but NOT the browser sessions, API keys work again at once), `enable`, `list-users [--json] [--search] [--limit]`,
`reset-password` (signs out everywhere); `--help` lists the options. Passwords come from `--password-stdin`, `--password` (warns: shell history), `AIVORE_ADMIN_PASSWORD` or a hidden prompt, never printed. Demoting or disabling the last
active admin needs `--force`. Exit codes: 0 done, 1 failed (unknown user, rejected input, database error), 2 wrong usage.

**Tests.** Helpers named `passwordFixture()`, `cleanSecurityState()` (tests/server/auth/support.ts) and `routeTestState()` (tests/app/api/v1/auth/support.ts) avoid the `use…` prefix that ESLint treats as a React hook. Route tests send
`createSession(...).headers` (cookie plus matching Origin) for browser calls and `authorization: Bearer avk_…` for API calls. Hashing is the slow part: build users with a shared real hash (`createUser(db, { passwordHash })`) instead of registering.

## 17. Backend as built (consolidated, owner `hardening`)

One page for operators and API consumers; the per-module detail is in §6.1 to §6.7 and §16. Routes added by later modules (email confirmation, password reset, account export and deletion, billing) are
documented in their own sections. Every route goes through `route()` (§6.1): JSON envelope, `X-Request-Id`, `Cache-Control: no-store` unless stated, CSRF check for cookie-authenticated mutations (non-browser clients
send `Origin: <APP_URL>` on login/register), 429 with `Retry-After` and `X-RateLimit-*` when a limit applies. "Per user" = per account for signed-in callers; the unknown-address column is for `TRUST_PROXY=false`.

**Endpoints, auth and limits** (budgets are per 60 s unless stated):

| Route | Auth | Limit (bucket) | Notes |
| ----- | ---- | -------------- | ----- |
| `POST /auth/register` | none, CSRF | 5 / h / address (`auth-register`); unknown address: 60 / h shared | 201 `UserDTO` + `aivore_session` and `aivore_locale` cookies, 50 credits (`SIGNUP_BONUS_CREDITS`) in the same transaction |
| `POST /auth/login` | none, CSRF | 10 / address (`auth-login`) + 10 / address + email (inside); unknown: only the 10 / email | one generic 401 for every failure; new token each time |
| `POST /auth/logout` · `POST /auth/logout-all` | none, CSRF · session | 30 / address, unknown: none · 10 / user | 204; idempotent |
| `GET /auth/me` | optional | 120 / user, address when anonymous (`auth-me`); unknown: 1200 shared | `{data: UserDTO}` or `{data: null}`, never 401 |
| `GET·PATCH /account`, `GET /account/ledger` | required | 60 · 20 · 60 / user | PATCH `{name?, locale?}` only |
| `POST /account/password` | session only | 5 / user | 204 |
| `GET·POST /keys`, `DELETE /keys/:id` | session only | 60 · 10 · 10 / user | secret returned once; at most 20 active keys |
| `GET /models`, `GET /tools` | optional | 240 / user or address, one `catalog` bucket; unknown: 2400 shared | `private, max-age=30` · `public, max-age=300` |
| `POST /prompt/enhance` | required | 20 / user (`prompt-enhance`) | body <= 16 KiB; blocked draft is 422 |
| `POST /uploads` | required | 20 / user (`uploads`) | multipart `file`, `(MAX_UPLOAD_MB + 1)` MiB, PNG/JPEG/WebP |
| `GET·HEAD /media/:assetId` | optional | 1200 / user or address (`media`); unknown anonymous: not counted | Range 206/416, ETag 304; owner or output of a public generation of an enabled account |
| `POST /generations` | required | 30 / user (`generations-create`) | body <= 64 KiB, `Idempotency-Key`, 201 (200 on replay); 402, 403 `email_not_verified` (where email confirmation is on), 409, 422, 429 `too_many_active`, 503 `service_busy` |
| `GET /generations`, `GET /generations/:id` | required | 600 / user (`generations-read`) + 60 / user for `?q=` (`generations-search`) | `?ids=` batch polling (<= 50) |
| `PATCH·DELETE /generations/:id`, `POST /generations/:id/cancel` | required | 60 / user (`generations-write`) | DELETE 204; cancel is idempotent for a canceled generation |
| `GET /explore` | none | 60 / address (`explore`); unknown: 1200 shared | `public, max-age=15, stale-while-revalidate=45`; default page 24 |
| `GET /api/health` | none | unlimited | bare `HealthDTO`; 503 when the database fails; `worker` is the configured `WORKER_MODE`, not liveness |

**Environment variables of the backend phase** (all in `.env.example`; `getEnv()` validates them all at the first call and reports every problem together):
`TRUST_PROXY` (default false: trust `X-Forwarded-For`, the proxy must append to it), `TRUSTED_PROXY_HOPS` (1..10), `RATE_LIMIT_DISABLED` (DANGER, e2e/load tests only, loud start-up warning),
`DAILY_UPSTREAM_BUDGET_CREDITS` (below), `FAL_KEY` (makes the nine `fal-*` models available), `ENABLE_MOCK_PROVIDER` (Demo models; turn off in production once real keys exist), `WORKER_MODE`
(`inline` | `external` | `off`), `MODERATION_PROVIDER` / `PROMPT_ENHANCER` and their keys. Start-up warnings (once per process): insecure `SESSION_SECRET` outside production, `RATE_LIMIT_DISABLED`, a non-empty
`ADMIN_EMAILS` (the first registrant of that address becomes admin), and in production `TRUST_PROXY=false`; plus the first-request warning about ignored forwarding headers (§16).

**Daily upstream budget** (`DAILY_UPSTREAM_BUDGET_CREDITS`, `generations/budget.ts`; 0 = off). Committed credits = the sum of `cost` of generations on PAID providers (anything but `mock`) created in the last 24 hours
(strictly younger than 24 h) whose status is `queued`, `processing` or `succeeded`: failed and canceled generations were refunded in full and free their share at once, a refund never frees more than its generation
took, a partial refund keeps the full cost committed. `createGeneration` on a paid model checks `committed + cost <= budget` INSIDE the transaction that debits the user and inserts the row (after the replay and
active-limit checks, before the debit), so concurrent requests cannot overshoot together (tested across processes); exactly reaching the budget is allowed. Otherwise: 503 `service_busy`, `details.retryAfterSec`
also as `Retry-After` (an estimate of when enough of the oldest committed generations leave the window, clamped to 60 s .. 1 h; 1 h when the request alone exceeds the budget), nothing debited or stored, one
throttled `warn` per minute ("Daily upstream budget reached", numbers only). A replay of an earlier request is answered even when the budget is now spent. The Demo provider is never counted or blocked. There is
no admin command for it (`scripts/admin.ts` is unchanged): read the log line, or sum the table with the query in `committedUpstreamCredits`.

**Failure semantics** (credits are always conserved: every debit is matched by a refund or a delivered result, tested with ledger-chain checks):
- Refused before anything is stored (422 validation or moderation, 404 input image, 409 model unavailable or key reuse, 402, 429 active limit, 503 budget): nothing debited.
- Provider failure, timeout, unusable or no output, storage failure, input image gone, retries exhausted: `failed` with a full idempotent refund (`refund:<id>`) and a user-safe code/message (§5). Fewer outputs than
  `count`: `succeeded` plus `floor(cost * missing / count)` refunded (`refund:partial:<id>`). A timed-out job is failed and refunded BEFORE the best-effort upstream cancel.
- Cancel or delete of a queued OR processing generation: `canceled` and a FULL refund, also after the provider accepted the job (policy of §8, not changed). Each such cancel logs "Canceled a generation after it
  was submitted to the provider" (ids and cost, never the prompt) so a create-and-cancel loop shows up as a high ratio of those lines to "Generation succeeded".
- Worker crash: the lease (60 s, heartbeat every 15 s) expires and the job is requeued and RESUMED by polling when the provider job id was stored, failed `unavailable` after `MAX_ATTEMPTS` claims, or, for a paid
  provider whose submit was in flight, failed `interrupted` and refunded (§6.6). Graceful stop (SIGTERM, `stop()`, inline process exit) hands jobs back at once. `kill -9` is noticed after the lease (up to 60 s).
- Queued jobs never expire: with `WORKER_MODE=off` or a dead external worker the credits stay debited until the user cancels (which refunds); four stuck jobs hit `MAX_ACTIVE_PER_USER`.
- Disabled accounts: sessions end, the account cannot log in (403 only after the right password), its shared results disappear from the feed, share page and media URLs.

**Known limitations and open issues**
1. **fal was never called live**: the build sandbox's network policy blocks every fal host, so submit/poll/cancel, the real response shapes, the CDN downloads and the acceptance of inline base64 inputs (about 5.6 MB of
   JSON) are verified only against the types of `@fal-ai/client`, its source and stubbed fakes. Before enabling fal in production run one cheap `fal-flux-schnell` and one image-to-image call from a host that can reach it.
   If fal answers 401/403 the cause is the key itself (format, scope or balance), not the code.
2. **Model prices are months-old excerpts** (fal model pages, 2026-10-08) and `fal-flux-dev-img2img` is priced at the higher of two conflicting quotes (10 credits instead of 8, `UNVERIFIED:` in the catalog); newer
   families (Nano Banana 2, Wan 3.0, Seedance 2.x, Kling v3, Veo 3.1 Lite) are not offered because their prices could not be read. Re-check a price on the model page before changing a number.
3. **Submit is not idempotent** (fal has no idempotency key): fixed as far as the engine can, see "Duplicate paid jobs" in §6.6. What remains: a submit that fails without an HTTP answer is final (the generation fails, refunded)
   instead of being retried, a worker killed mid-submit fails that one job (refunded) instead of re-submitting, and the platform eats the upstream charge of such a request.
4. **Full refund after the provider accepted a job** (cancel and delete) is a policy that lets a create-and-cancel loop cost the platform money while the user pays nothing; options are to refund fully only while queued or
   before `providerJobId`, or only after `provider.cancel` confirmed, or to keep a small share. Until decided, operators can alert on the log line above, and `DAILY_UPSTREAM_BUDGET_CREDITS` bounds the damage.
5. **Rate limits are per process** (several instances each enforce their own budget; swap a shared store in with `setRateLimiter`). Without `TRUST_PROXY=true` anonymous callers cannot be told apart: they share one
   budget per route class (10x larger than per address), so a script can exhaust the anonymous budget of a class, and the shared `register` budget (60 / h) is a sign-up lockout lever; signed-in users are never affected.
6. **Not live-verified, by design**: the S3 driver (injected client only), the OpenAI/Anthropic enhancer and OpenAI moderation endpoints (`// UNVERIFIED:`), `next build`/`next dev` of the integration run. The OpenAI and
   Replicate adapters are stubs. `public/openapi.json` and `GET /openapi.json` do not exist yet.
7. `safeFetch` buffers a whole download (up to 500 MB per video), so the worst case is `WORKER_CONCURRENCY` x 500 MB; a provider's `progress` is read as a percentage 0-100; `/api/health` does not report worker liveness
   (`isWorkerRunning()` in `jobs/start.ts` exists for it); unused uploads and per-user storage are not limited or swept; the session cookie is `Secure` whenever `NODE_ENV=production` (HTTPS required).
8. Moderation is a conservative starting point (§6.7): reversed text, split words, images/OCR and dialects are not covered; the Arabic list needs a native-speaking reviewer; keep `MODERATION_PROVIDER=openai` on for a real deployment.

## Billing (as built, owner `billing-core`)

Code: `lib/billing/**` (isomorphic: prices, VAT, margin, money formatting, time rules), `server/billing/**`, `app/api/v1/billing/**`,
`app/billing/mock-checkout/**` (development-only fake payment page), the billing commands of `scripts/admin.ts`. Tests: `tests/{lib,server}/billing`,
`tests/app/api/v1/billing` (all offline). The buyer-facing pages (`/billing/return`, the plans and billing screens) are a separate UI task that reads this API.

**What is sold.** Credits, in Saudi riyals, through Moyasar: one-time **packs** and **monthly plans** (monthly credits). Credits never expire (stated in the price list, the
catalog DTO and the UI copy to come). Prices live ONLY in `lib/billing/plans.ts` (integer halalas, 15% VAT INCLUDED, `splitVat` gives net/VAT; `VAT_RATE_PERCENT` is the
rate stored on each order). A checkout request names an item (`{type:'pack'|'subscription', id}`), never an amount; the body schema is strict, so an `amount` field is a 422.
Margin model (`lib/billing/margin.ts`, table in the header of `plans.ts`, asserted by a test and printed by `npm run admin -- billing-prices`): 1 credit = USD 0.004
upstream cost (the fal catalog rounds every price up to whole credits) x 3.75 = SAR 0.015; revenue after 15% VAT and a pessimistic gateway cost (3% + SAR 1) must be at least
2.5x that. Proposed list: packs 500 / 1,500 / 5,000 credits for SAR 29 / 79 / 229 (3.11x / 2.90x / 2.55x); plans Starter 1,000 / Pro 3,000 / Studio 10,000 credits a month
for SAR 49 / 139 / 449 (2.68x / 2.57x / 2.51x). They are configuration the owner tunes; Moyasar's real rates are quoted by their sales team and are NOT public.

**Design decision: hosted checkout, renewals by payment link.** The buyer pays on Moyasar's hosted invoice page, so card data never touches this server (no card number,
token or CVC is ever received, stored or logged). Subscriptions renew by a **payment link with a grace period**, not by charging a saved card: Moyasar's token charging needs the
`tokenization` feature enabled on the merchant account by their sales team, a token charge without 3-D Secure depends on the token being "active" and on issuer rules, and the
docs never say how an off-session (merchant-initiated) charge is marked or whether SAMA rules allow it. None of that could be verified or tested here, and money code must not be
written on guesses. Timeline of a month ending at `E` (`lib/billing/period.ts`): the renewal order and its Moyasar invoice are created at `E - 3 days`, the subscription
becomes `past_due` at `E` (the link stays payable), and it `expired`s at `E + 7 days` (the link is withdrawn); paying at any point before that moves it to the next month, counted
from `E`, so paying early or late loses nothing. Credits already granted are never taken back for non-payment. **Adding token renewals later** is additive: a `chargeToken` method on the
gateway interface, a `gatewayToken` column (sensitive, never logged) and one more `planStep` branch; the order/settle/refund code needs no change. The renewal link is shown through
`GET /billing/subscription` (`pendingOrder.checkoutUrl`); it is NOT emailed yet (no billing mail exists; the email module landed separately, see open issues).

**Data model** (migration `0003`, additive; none of the tables cascades from `users`, financial records outlive accounts).
- `subscriptions`: `id, userId, planId, status (incomplete|active|past_due|canceled|expired), anchorDay, currentPeriodStart/End, cancelAtPeriodEnd, nextChargeAt, canceledAt, createdAt, updatedAt`.
  Partial unique index `(userId) where status in (incomplete, active, past_due)`: one live subscription per account, enforced by the database. `nextChargeAt` is the scheduler's
  appointment (and carries a 15-minute lease while a process works on the row, which is also the pause between attempts while the gateway keeps failing). `anchorDay` keeps month ends from drifting (31st -> 28th -> 31st).
  Deliberately NOT built: `gatewayToken` and `failedAttempts` (they belong to token charging, see above).
- `orders`: `id, userId, kind (pack|subscription_initial|subscription_renewal), itemId, amountHalalas, currency ('SAR' by CHECK), vatHalalas, credits, status
  (pending|paid|failed|canceled|refunded|needs_review), gateway (mock|moyasar), gatewayInvoiceId, gatewayPaymentId, checkoutUrl, subscriptionId, idempotencyKey, expiresAt,
  periodStart/End, refundedHalalas, clawedBackCredits, lastCheckedAt, createdAt, paidAt, updatedAt`. Amount, VAT, credits and currency are copied from the server price list at creation and
  are the only numbers a payment is compared with. **`paidAt is not null` means "the credits were granted"** (same transaction). Unique: `(userId, idempotencyKey)`, `(gateway, gatewayInvoiceId)`,
  `(gateway, gatewayPaymentId)`, and one pending renewal per subscription (partial index).
- `billing_events`: `id, gateway, eventKey (UNIQUE), orderId, type, payloadHash, receivedAt, processedAt`. The body is never stored, only a hash of it WITHOUT the shared secret.
- Ids: prefixes `ord`, `sub`, `bev` were added to `lib/id.ts`. Credits: `reason 'purchase'` (idempotency key `order:<orderId>`) and, for clawbacks, `reason 'adjustment'` with a negative delta
  (key `clawback:<orderId>:<refunded total>`), written by `server/billing/clawback.ts` with the same rules as `credits/index.ts` (one transaction moves the cached balance and appends
  the ledger row; `UPDATE` refuses to go below zero, the column CHECK is behind it).

**The money rules and how the code keeps them.**
1. *Amounts and currency come only from the server.* `findPurchasable` (config) + `VAT_RATE_PERCENT` (env); the order row is the contract.
2. *Nothing the browser or the gateway SENDS is trusted.* `settleOrder` (`settle.ts`) is the single place that credits or claws back. Every caller (webhook, buyer's return, order poll,
   scheduler, operator) only triggers it; it asks the gateway API (`fetchPayment`: GET the invoice we created, by OUR stored invoice id) and applies that answer. A payment must match the
   order in **status, amount, currency and our order reference** (`metadata.order_id` echoed by Moyasar); any mismatch credits nothing and moves the order to `needs_review` (logged at error).
3. *Every state change is a compare-and-set in ONE synchronous transaction* (`transitions.ts`: `markPaid` = order CAS + `grantCredits` + subscription activation; `applyRefund` =
   clawback + order CAS + subscription end). No await inside. A replayed, duplicated, concurrent or out-of-order event finds the status it expects gone and changes nothing; the ledger
   idempotency keys are a second line. Verified across OS processes (`tests/server/billing/race.test.ts`) and by a random-sequence conservation test (40 seeds x 70 steps).
4. *A late payment is never lost.* `pending|failed|canceled -> paid` is allowed when the gateway says paid. A payment returned before we credited it ends `refunded` with no credit.
5. *Refunds and chargebacks* (started by `refund-order`, in the Moyasar dashboard, or by the card network) are read from the gateway when we next look (webhook, poll, scheduler): the order's
   `refundedHalalas` only grows; credits taken back = all of them for a full refund, `floor(credits x refunded / amount)` for a partial one, **never more than the balance**. A shortfall
   (credits already spent) leaves `needs_review`, `clawedBackCredits < credits`, and an error log; the balance never goes negative. Fully refunding the payment that funded the CURRENT
   month ends the subscription at once; refunding an older month does not.
6. *Webhooks* (`webhooks.ts`): authenticated by the adapter, recorded by `eventKey` (a redelivery of a processed event is a no-op, an unprocessed one is handled again), mapped to an order by
   invoice id / payment id / `metadata.order_id` (only to choose WHERE to look; an unknown payment is acknowledged and ignored, the same Moyasar account may take other payments), then
   `settleOrder`. A gateway outage while handling answers 5xx so Moyasar retries (1, 10, 30, 60, 120 minutes).
7. *The scheduler is the safety net* for a missed webhook: unpaid checkouts are re-asked every 20 s for the first 10 minutes, every 5 minutes up to 2 hours, then every 30 minutes; one still
   payable an hour after its page expired is closed by force.
8. *Closing a checkout* (`closeCheckout`) tells the gateway to cancel the invoice, then asks what is true (the buyer may have paid a moment ago: then it settles as paid). If the invoice is still
   payable afterwards the order stays `pending` and the call throws.

**Gateways** (`server/billing/gateway.ts`: `createCheckout`, `fetchPayment`, `cancelCheckout`, `refund`, `verifyWebhook`; no token method).
- `moyasar.ts`: HTTP Basic auth (secret key as user name, empty password), JSON via `fetch` with a 15 s timeout, 1 MB response cap, `redirect: 'error'` (credentials are never re-sent), lenient zod
  schemas that read only what is needed, errors mapped to `provider_error` 502 (the upstream `message` is logged truncated, never a header or body). The header comment lists what was VERIFIED
  from Moyasar's docs (read through search excerpts: docs.moyasar.com was unreachable from the build sandbox) and every `UNVERIFIED` detail, all confined to this file: exact invoice/payment/webhook
  JSON beyond `id/status/amount/currency/url/metadata/payments[]`, the `expired_at` format, whether the webhook payment carries `invoice_id` and the invoice metadata, the HTTP error body, how a
  partial refund and a chargeback show up (amounts decide, not status names; voided/refunded read as "money returned"), and that webhooks are authenticated only by the `secret_token` body field
  (compared in constant time, `secretsMatch` hashes both sides to equal length; no signature header is documented). The success/back URL of the invoice is `/api/v1/billing/return?order=<id>`.
- `mock.ts`: the in-process fake. Same interface, same webhook body, a hosted page at `/billing/mock-checkout/[orderId]` (owner only, 404 otherwise) with **Pay** and **Fail** buttons. A button
  changes the payment on the fake gateway's side, delivers the webhook through the REAL route handler (`POST /billing/webhooks/moyasar`, with its auth, limits and idempotency) and redirects to the
  real return URL; nothing touches an order directly. State is in memory per process (a restart forgets open fake checkouts; the page says so).
- Selection (`lib/billing/gateway-config.ts`, pure, swept by tests): `BILLING_GATEWAY=auto` is Moyasar in production when `MOYASAR_SECRET_KEY` is set, **off** in production without it, the fake
  in development and test. `mock` can **never** be selected in production, three independent ways: `parseEnv` rejects `BILLING_GATEWAY=mock` there, `resolveBillingMode` maps it to `off`, and `mock.ts`
  refuses to be built when `NODE_ENV=production`; the page answers 404 first thing. `off` (or production without a key) makes buying a 503 `{reason:'billing_disabled'}`.
  Key safety: `sk_live_`/`pk_live_` are refused outside production unless `MOYASAR_ALLOW_LIVE_IN_DEV=true` and `sk_test_`/`pk_test_` are refused in production unless
  `MOYASAR_ALLOW_TEST_IN_PRODUCTION=true` (test cards would otherwise buy real credits for free). The rule applies to the Moyasar gateway that would actually run (at env parse and again when the
  gateway is built); a live publishable key sitting unused in `.env.local` while the fake is selected is harmless and not an error. Mixed test/live keys, malformed keys and a webhook secret shorter than
  16 characters are refused, never quoting a key. `MOYASAR_API_BASE` must be an https `moyasar.com` URL (it receives the secret key) except under `NODE_ENV=test`.

**Environment** (additive, `.env.example`): `BILLING_GATEWAY` (`auto|mock|moyasar|off`), `MOYASAR_SECRET_KEY`, `MOYASAR_PUBLISHABLE_KEY` (validated only: the hosted flow does not need it, so the
public price list never exposes any key), `MOYASAR_WEBHOOK_SECRET`, `MOYASAR_API_BASE`, `MOYASAR_ALLOW_LIVE_IN_DEV`, `MOYASAR_ALLOW_TEST_IN_PRODUCTION`, `VAT_RATE_PERCENT`. The billing keys are in
`tests/helpers/isolated-env.ts`, so no test or e2e run inherits a gateway key. **Go-live checklist**: set `MOYASAR_SECRET_KEY` (live) and a long `MOYASAR_WEBHOOK_SECRET`; in the Moyasar dashboard create a webhook
to `https://<APP_URL>/api/v1/billing/webhooks/moyasar` with that secret as its `secret_token`; keep `TRUST_PROXY=true` behind a proxy; run `npm run admin -- billing-prices`; make a SAR 29 purchase and refund it.
Without the webhook secret every webhook is rejected (fail closed) and payments are confirmed on return and by the scheduler within a minute.

**Routes** (all `route()`; money routes are browser-session only: an API key gets 403 for every `/billing/*` route except the public price list; cookie requests get the CSRF origin check):

| Route | Auth | Limit | Notes |
| ----- | ---- | ----- | ----- |
| `GET /billing/plans` | none | 120 / min / address (unknown address: 1200 shared) | `BillingCatalogDTO`; `Cache-Control: public, max-age=300`; gateway mode, VAT, packs, plans, renewal lead/grace days |
| `POST /billing/checkout` | session | 10 / min / user | body `{type, id}` strict; **`Idempotency-Key` required** (1-128 visible ASCII); 201 `OrderDTO` (`checkoutUrl` = where to pay), 200 + `Idempotent-Replayed` on a retry; 409 `idempotency_key_reused` / `checkout_in_progress` / `subscription_exists`; 429 `too_many_active` (5 unpaid checkouts); 404 unknown item; 503 `billing_disabled`; 502 gateway |
| `GET /billing/orders` | session | 60 / min / user | `Page<OrderDTO>`, newest first |
| `GET /billing/orders/:id` | session | 60 / min / user | owner only (others and malformed ids: the same 404); while pending it asks the gateway (at most every 3 s per order, one call shared by concurrent polls) so the return page updates without a webhook |
| `GET /billing/subscription` | session | 60 / min / user | `SubscriptionDTO` (running, else the last ended) or `null`; `pendingOrder` carries the first-month or renewal `checkoutUrl` |
| `POST /billing/subscription/cancel` · `/resume` | session | 10 / min / user | cancel: ends with the paid month, withdraws the renewal link, idempotent (past due: ends now; unpaid first month: abandoned); resume: only while the paid month runs (409 `subscription_ended` after) |
| `POST /billing/webhooks/moyasar` | none (shared secret), no CSRF | 600 / min / address | body <= 64 KiB; 200 `{received, result}`, 401 not authentic, 400 not a webhook, 5xx retry |
| `GET /billing/return?order=` | none | 60 / min / address | the gateway's success/back URL: re-checks the order, 303 to `/billing/return?order=<id>` (only an id found in our database is echoed; anything else goes to `/billing/return`) |

**Scheduler** (`scheduler.ts`): `tick(now)` (injected clock) closes crash leftovers (a checkout row without a payment page after 2 minutes: nobody could have paid it), reconciles unpaid checkouts, withdraws
renewal links of ended subscriptions, and walks due subscriptions through `planStep` (pure: `issue_renewal`, `mark_past_due`, `expire`, `finalize_cancel`, `wait`). Safe from several processes: every unit
of work is claimed by a compare-and-set that writes a lease (`orders.lastCheckedAt`, `subscriptions.nextChargeAt + 15 min`) and every change it makes is a compare-and-set; a crashed claimant is replaced when the
lease ends. `startBillingScheduler()` / `stopBillingScheduler()` run `tick` every 30 s (unref'd timer, singleton on `globalThis`); `server/billing/boot.ts` starts it from `instrumentation.ts` (additive,
own try/catch, independent of the job runner, skipped for `WORKER_MODE=off` and when billing is off).

**Admin CLI** (`npm run admin -- ...`, logic in `server/billing/admin-cli.ts`, dispatched from `scripts/admin.ts`; `grant-credits` stays as it is): `billing-orders [--status] [--email] [--limit] [--json]`,
`refund-order <ord_...> [--amount-sar 25.50]` (gateway refund, then the same settle path that claws credits back; warns when credits had been spent), `settle-order <ord_...>` (both also accept `--id`), `billing-prices`.

**Tests** (`tests/server/billing`, `tests/lib/billing`, `tests/app/api/v1/billing`): a stateful fake Moyasar (`fake-moyasar.ts`, Moyasar-shaped JSON behind a stubbed `fetch`) under the REAL adapter and services:
pack purchase, subscription start/renew/past_due/expire/cancel/resume/refund, duplicate + concurrent + out-of-order webhooks and returns, amount/currency/reference mismatch, refunds, chargebacks and
clawback with insufficient balance, idempotent and concurrent checkout, IDOR, API-key purchase denied, CSRF, webhook authentication failures, live-key and mock-in-production guards, scheduler races
across two and four OS processes (`race-worker.ts`), and the ledger-conservation property test over random event sequences.

**Open issues / not built.** (1) `/billing/return`, the plans/billing pages and the account billing section do not exist yet; the mock page links to `/billing/return`. (2) No email: renewal links, payment
receipts and refund notices need the email module (`server/email`, landing separately); the data to send is in `OrderDTO`/`SubscriptionDTO`. (3) No ZATCA tax invoice / receipt PDF (VAT per order is stored for it).
(4) One live subscription per account; changing plan means cancelling and subscribing again after the month ends. (5) Gateway fee and Moyasar behaviours listed as UNVERIFIED above must be confirmed in the
Moyasar sandbox with `BILLING_GATEWAY=moyasar` and `sk_test_` keys before going live. (6) Production-mode e2e cannot use the fake gateway by design; drive billing e2e through a stub on `MOYASAR_API_BASE`
under `NODE_ENV=test` or against the dev server.

## 18. Trust & safety (as built, owner `trust-auth`)

Account recovery, email confirmation, sign-up abuse controls and data rights. Code: `server/email/**`, `server/auth/{email-*,verification,password-reset,signup-guard,bonus,disposable-domains,account-*,background,notifications}.ts`,
`app/api/v1/auth/{verify-email,password}/**`, `app/api/v1/account/{export,route (DELETE)}`, `app/(auth)/{forgot-password,reset-password,verify-email}`, `components/auth/{forgot-password-form,reset-password-form,verify-email-panel,account-data-rights,…}`,
`components/layout/verify-email-banner.tsx`. It supersedes these statements of §16: "emails are not verified" (now: when confirmation is required), "no email verification or emailed password reset", and the sign-up bonus being always part of registration.

**Email (`server/email`).** `queueEmail(renderEmail(spec))` from routes (returns at once; delivery runs on a later event-loop turn), `sendEmail(message)` (awaitable, returns `{ ok } | { ok: false, error }`; CLI and tests), `flushEmails()` (waits for the queue).
Transport: `SMTP_URL` (`smtp://user:pass@host:587`, `smtps://` = implicit TLS) or `SMTP_HOST/PORT/USER/PASS/SECURE`, plus `EMAIL_FROM` (required once SMTP is set; both forms together are refused); nodemailer is imported lazily on first send. Credentials are only ever sent over TLS
(`requireTLS` when there is a login and the connection is not already secure), timeouts 10/10/20 s, TLS >= 1.2. Without SMTP the **outbox transport** is used: nothing leaves the machine, messages go to a bounded in-memory list (`getOutbox()`, `lastOutboxMessage(to?)`, `clearOutbox()`)
and to `outbox.jsonl` next to `DATABASE_PATH` (mode 0600, one JSON object per message: `to`, `subject`, `text`, `html`; none for `:memory:`); one `info` line per message with the masked address (`l***@example.com`), never body or link. The outbox holds working links: development only
(production without SMTP logs a warning once). Delivery: 25 s deadline per attempt, one retry (not after a 5xx SMTP answer), then an `error` log (masked address, reason, never body/link/credentials) and a **metadata-only** `status: 'failed'` outbox record (a secret does not belong in a file because a relay was down).
Templates (`templates/{copy,layout,render}.ts`): kinds `verification | password_reset | password_changed | welcome | account_deleted`, ar/en by the user's locale (`defineMessages` parity, checked by `tests/server/email/copy.test.ts`), table layout with inline styles, a dark block under `prefers-color-scheme`,
no remote images/fonts/scripts, every interpolated value HTML-escaped, `dir="rtl"` on document, body and tables for Arabic, Latin values wrapped in isolated spans (and Unicode isolates in the plain text), Intl for numbers, durations and dates. Links come from `APP_URL` only (`appLink`), never from a request header.
Adding a kind (billing receipts, say): add it to `EMAIL_KINDS`, copy to `emailCopy` (both languages), a case in `renderEmail`, and call `queueEmail`.

**Tokens (`email_tokens`, `server/auth/email-tokens.ts`).** `issueEmailToken(db, userId, 'verify'|'reset')` returns `{ id, secret, expiresAt }`; the secret (32 random bytes, base64url) is only in the emailed link, the table stores `hashToken('email-token:<type>:<secret>')` (keyed with SESSION_SECRET, domain-separated per type so
a secret is useless for the other kind or as a session token). Lifetimes: verify 24 h, reset 1 h. `consumeEmailToken(tx, …)` is a compare-and-set (`usedAt IS NULL`) inside the transaction that acts on the link (a failure burns nothing) and throws `EmailTokenError` (400 `bad_request`, `details.reason`
`invalid | expired | used`). At most 5 live links per user and kind (older ones are retired), used/expired rows purged after 7 days (at most hourly), rows cascade with the user.

**Confirmation policy.** `EMAIL_VERIFICATION=auto|required|off` (default `auto`) via `isEmailVerificationRequired()`: required iff `required`, or `auto` with SMTP configured (a fresh checkout without SMTP keeps today's zero-config flow). `required` without SMTP in production is refused at start-up (nobody could confirm).
| policy | SMTP | confirmation | at registration | on confirmation |
| ------ | ---- | ------------ | --------------- | --------------- |
| auto | yes / no | required / not | required: 0 credits, role `user`, link mailed. Not required: bonus granted, `ADMIN_EMAILS` -> admin, welcome mail only if SMTP | required: bonus + admin promotion + welcome mail |
| required / off | any | yes / no | as above | as above |
Unconfirmed accounts may log in and browse; **`POST /generations` answers 403 `email_not_verified`** for them (session and API key), enforced by one line in `app/api/v1/generations/route.ts` reading the new optional `AuthContext.mustVerifyEmail` (true iff policy requires and `users.emailVerifiedAt` is null).
`markEmailVerified(tx, userId)` (idempotent, sync) sets `emailVerifiedAt`, promotes an `ADMIN_EMAILS` address and grants the bonus via `grantSignupBonus`; a password reset also calls it (receiving the mail proves the mailbox). Operator-created accounts (`provisionUser`, CLI) are confirmed at once.
`grantSignupBonus` (`bonus.ts`) is idempotent twice over: ledger key `signup_bonus:<userId>` (an existing bonus is left alone even if `SIGNUP_BONUS_CREDITS` changed) and one row per **mailbox** in `signup_bonus_claims` (keyed hash of the canonical address, kept after account deletion), so delete-and-register-again cannot claim a second bonus.
Routes: `POST /auth/verify-email/request` (session or key, 6 / h / user, 60 s gap: 429 `rate_limited` with `details.retryAfterSec`, 202 `{ sent, verified, resendAfterSec }`, 200 `sent: false` when already confirmed) and `POST /auth/verify-email/confirm {token}` (no session needed, per-address 30 / h, unknown address 1200 / h, 200
`{ verified, alreadyVerified, bonusCredits }`). The link opens the **page** `/verify-email?token=` which POSTs the token: loading a page changes nothing, so mail scanners that fetch links cannot burn them; the page strips the token from the URL once the outcome is known. UI: `VerifyEmailBanner` (rendered by `(app)/layout.tsx` while
`getVerificationState(userId)` says required and unconfirmed; resend with the server's gap as a countdown, re-reads the page when the tab regains focus), pages for success / expired / invalid / used / network error.

**Password reset.** `POST /auth/password/forgot {email}` always answers 202 `{ accepted: true }`: the lookup, token and mail run *after* the response (`runInBackground`, tests `flushBackground()`), so response and timing cannot depend on the account (syntax errors are 422, address-level limits 429; neither says anything about accounts). Limits: 10 / h per
address (unknown address: 300 / h shared), and 3 / h per target mailbox in canonical form (spent budget is silent: still 202, nothing sent); the service also refuses a second mail to one account within 60 s; unknown, disabled and deleted accounts get nothing. `csrf: true` like login. `POST /auth/password/reset {token, password}` (10 / h per address, unknown 600 / h): checks the link, then the
password policy (a weak password is 422 at `password` and leaves the link usable), hashes, then in ONE transaction burns the link, stores the hash, **deletes every session**, retires the other reset links and confirms the mailbox; afterwards a "password changed" notice goes out. API keys stay valid (revoke them in the account). 204, no cookie (the user logs in again).
UI: `/forgot-password`, `/reset-password?token=`, a "Forgot password?" link in the login form.

**Sign-up abuse.** `users.emailCanonical` (unique): `canonicalizeEmail` drops `+tags` on every domain and dots on Gmail/Googlemail (`a.b+x@gmail.com` and `ab@googlemail.com` are `ab@gmail.com`); the account keeps the address as typed; an alias of a registered mailbox is the same generic 409 `conflict` as a plain duplicate. The migration backfills `email_canonical = email`.
Throwaway domains (`disposable-domains.ts`, about 150 well-known ones, subdomains included, plus `DISPOSABLE_EMAIL_DOMAINS`) are refused before any hashing with 422 `email_not_allowed`. Per-address daily cap `SIGNUPS_PER_IP_PER_DAY` (default 5, 0 = off, also off with `RATE_LIMIT_DISABLED`): counted in the registration transaction from `users.signupIp` over a rolling 24 h,
429 `signup_limit`; with an unknown address (no trusted proxy) everybody shares a 20 times larger budget. New error codes `email_not_verified` (403), `email_not_allowed` (422), `signup_limit` (429), with ar/en messages.

**Data rights.** `GET /account/export` (session only, 3 / day / user, refuses `Sec-Fetch-Site: cross-site`): streamed JSON (`format: aivore-account-export/1`) with profile, sessions (no tokens), API key metadata (never a secret or hash), the full ledger, generations (what was asked and the outcome, no provider internals) and assets with
`url`/`thumbUrl`; every query is scoped to the authenticated user id, there is no id to tamper with. `DELETE /account {password}` (session only, same-origin checked, 5 / h / user, wrong password 422 at `password`): `deleteAccount(userId)` runs the registered `onAccountDeleted` hooks FIRST (a failing or stuck hook stops everything with 502 `provider_error`, account untouched,
retryable), then one transaction tombstones the row (`<id>@deleted.invalid`, name cleared, hash destroyed, role `user`, `signupIp` erased, `disabledAt` + `deletedAt` set), cancels and refunds running generations, deletes sessions and email links and revokes API keys; then files and rows are removed in batches (`purgeAccountContent`: objects first, rows after, so a failure keeps the row
as the to-do list; `resumeAccountPurges()` / CLI `purge-deleted` finish it). **Kept on purpose:** the user row, the credit ledger (its `generationId`s are nulled) and billing rows, for accounting; they no longer name a person. The last active administrator cannot delete themselves (409) unless an operator forces it. A confirmation email goes to the old address.
**Billing seam:** `onAccountDeleted(name, handler)` / `listAccountDeletedHooks()` in `server/auth/account-hooks.ts` (registry on `globalThis`, same name replaces, handlers must be idempotent, 20 s each). Billing should register `cancelSubscription` here from its start-up (`instrumentation.ts` AND `scripts/admin.ts`, which does not load other modules).

**Admin CLI** (`npm run admin -- …`): `users-stats [--json]` (also `users stats`), `resend-verification <email>` (no 60 s gap), `force-verify <email>` (also grants the missing bonus), `delete-user <email> | --id <usr_…> [--yes] [--force]` (without `--yes` it only lists what would go), `purge-deleted`. The email may be `--email x` or the first argument.

**Environment** (all in `.env.example`): `SMTP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`, `EMAIL_VERIFICATION`, `DISPOSABLE_EMAIL_DOMAINS`, `SIGNUPS_PER_IP_PER_DAY`; the same names are in `tests/helpers/isolated-env.ts` (unit tests and the e2e server never inherit a developer's SMTP). **Schema** (`0001_*`): `users.{emailVerifiedAt, emailCanonical (unique), signupIp, deletedAt}`,
tables `email_tokens` and `signup_bonus_claims`; id prefix `etk`. **Also additive:** `AuthContext.mustVerifyEmail`, `ApiClient.delete(path, { body })`, `ISOLATED_ENV_KEYS`. **Tests:** `tests/server/{email,auth}`, `tests/app/api/v1/{auth,account}`, `tests/components/auth`; the end-to-end journey (register, confirm, forget, reset, export, delete) with a log-capture check that no secret is ever logged is `tests/app/api/v1/auth/recovery-flow.test.ts`.
**Operational notes.** Existing accounts have no `emailVerifiedAt`: when confirmation becomes required (SMTP configured) they must confirm through the banner, or an operator runs `force-verify`. Sessions and rate limits are per process. `ADMIN_EMAILS` promotion happens at confirmation when confirmation is required (so an unconfirmed squatter is never admin).

## Legal pages (as built, owner `legal`)

Bilingual (ar + en) **DRAFT** terms, privacy, refund and acceptable-use pages at `/terms`, `/privacy`, `/refunds`, `/acceptable-use` (public, `(marketing)` group, so site chrome + their own `<main id="main-content">`). They are templates for the owner's counsel, not legal advice, and say so on the page.
Code: `lib/legal.ts`, `lib/i18n/messages/legal.ts` (namespace `legal`, registered in `lib/i18n/index.ts`), `components/legal/**`, `app/(marketing)/{terms,privacy,refunds,acceptable-use}/page.tsx` (four thin pages: `generateMetadata` + `<LegalDocument slug>`). Additive edits elsewhere: the footer's "Legal" column (`components/layout/site-footer.tsx`), the consent line of `components/auth/register-form.tsx`, four entries in `app/sitemap.ts`, six variables in `.env.example`.
Tests: `tests/components/legal/**` (parser, content and drift guards, company details, text/page/consent/footer rendering, namespace parity, real-browser layout, axe, print), `tests/app/legal-pages.test.tsx`, `tests/app/legal-sitemap.test.ts`.

**What the owner has to do before launch** (all in `lib/legal.ts` / `.env`): set `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_CR_NUMBER`, `VAT_NUMBER`, `CONTACT_EMAIL` (legal, privacy, abuse reports), `SUPPORT_EMAIL` (billing, refunds, support); have counsel review `lib/i18n/messages/legal.ts` (every `{confirm}` in the text is a decision that is theirs: ages, liability cap, governing law and courts, retention periods, refund window, notice periods, the Arabic-prevails clause...); set `LEGAL_DRAFT = false` (removes the "Draft — pending legal review" notice and every "To confirm" flag; unset company details stay visible as placeholders); bump `LEGAL_LAST_UPDATED[slug]` whenever a document's wording changes.

**Company details are never invented.** `readCompanyInfo(source = process.env)` reads the six variables per request (the pages are dynamic; `getEnv()` was not extended because `server/env.ts` is not this module's). Blank values count as unset, whitespace and control characters are flattened, over 300 characters or an email that is not ONE plain address (no name, no second recipient, no `?subject=`/`mailto:`/quotes: it becomes a `mailto:` link) counts as unset. Unset values render as `<mark data-placeholder="…">[Company name: to be provided]</mark>`; set ones render escaped inside `<bdi>`; emails become `mailto:` links.

**Content model.** The text lives in the dictionary as `legal.<doc>.sections.<id>.{title,body}` (`doc` = `terms | privacy | refunds | acceptableUse`); the key order is the order on the page and in the table of contents, the key (camelCase) becomes the anchor (`yourContent` -> `#your-content`), so adding a section is adding its key in both languages. A body is tiny markup parsed by `components/legal/markup.ts`: blank line = paragraph, `- ` = bullet, `### ` = sub-heading, `**bold**`, `[[code]]`, `[label](/path)` (only pages in `LEGAL_LINK_TARGETS`, anything else renders as its label) and `{token}`: the six company fields, `{confirm}` (the "To confirm" chip, dropped together with the space before it when `LEGAL_DRAFT` is false) and four numbers filled from code, so the wording cannot drift from behaviour: `{vatPercent}` = `getEnv().VAT_RATE_PERCENT`, `{leadDays}`/`{graceDays}` = `RENEWAL_LEAD_MS`/`RENEWAL_GRACE_MS` of `lib/billing/period.ts`, `{refundDays}` = `REFUND_WINDOW_DAYS` (a DRAFT default of 7, flagged). Raw HTML in a dictionary is escaped, never rendered.

**Components.** `LegalDocument` (async server component: dictionary + env + `getI18n()`; props `slug`, and `company`/`draft` for tests) fills `LegalPage` (pure, text in / markup out: title block, `<time>` of the last update, `DraftNotice` (`role="note"`), `LegalToc`, numbered `<section aria-labelledby>`s with `scroll-mt-24`, links to the other three documents). `LegalToc` is a sticky `<nav>` beside the text from `lg` and a collapsed `<details>` above it below `lg` (two renderings, only one landmark). Print: an inline `@media print` block hides the site `<header>`/`<footer>` (so the page itself uses neither element), the contents and the related links, forces dark-on-white token values (a dark-theme reader would otherwise print near-white text), sets `@page` margins and keeps the draft notice. `ConsentLine` (client) renders "By creating an account, you agree to the Terms of Service and the Privacy Policy" from `legal.consent.line` with `{terms}`/`{privacy}` where the links go (Arabic orders its own words); links open in a new tab (`rel="noopener"`, sr-only "opens in a new tab") so the half-filled form stays, and the submit button is `aria-describedby` the line. There is deliberately no checkbox: the sentence is notice-and-agree by submitting, and it adds no field or request.

**What the documents say, and where it was verified in code** (guarded by `tests/components/legal/content.test.ts`, which fails when the text and the code drift): cookies = exactly `SESSION_COOKIE_NAME`, `LOCALE_COOKIE`, `THEME_COOKIE`, `SIDEBAR_COOKIE` (no analytics, no third-party cookies; studio settings in `localStorage`, never sent); session lifetimes = `SESSION_TTL_MS`/`SESSION_ABSOLUTE_MAX_MS` (30 / 180 days); email link lifetimes = `TOKEN_TTL_MS` (24 h / 1 h); failed, canceled and short generations are refunded in credits automatically and a moderation-blocked request is never charged (§8, §17); renewal is by payment link, not card charging (3 days before the period ends, `past_due` then expiry after 7 days, cancel = ends with the paid month, refunding the current month's payment ends the plan and claws credits back up to the balance; "Billing (as built)"); Moyasar receives only amount, description and our order reference and card data never reaches us; fal.ai receives prompt, settings and input image; processors named: fal.ai, Moyasar, an email provider, optional moderation/enhancer providers, hosting; deletion keeps the credit ledger and billing rows without a person's name and one keyed hash of the mailbox (anti bonus abuse) (§18); public generations show the account name.

**Known gaps (for the owner and counsel).** The wording is a proposal, not reviewed law: PDPL/GDPR bases and rights, the E-Commerce Law's consumer rights, the VAT invoice (no ZATCA invoice exists yet: the text only says to write to support), the age limit, the liability cap, the refund window and every `{confirm}` clause. The text says users can cancel a plan, see the renewal link and export/delete their data "in your account": the API and `AccountDataRights` exist, the account/billing screens that expose them are other modules' work. The retention window of used/expired email links (7 days) is a private constant of `server/auth/email-tokens.ts`, so only that number is not drift-guarded. Backups and log retention, hosting location, and the competent authority are not known and are flagged, not invented. `tests/lib/i18n/messages.test.ts` lists namespaces by hand and does not include `legal` (the same checks run in `tests/components/legal/messages.test.ts`).

## Studio & shared generation UI (as built, owner `studio`)

`/studio` (`app/(app)/studio/{page,loading}.tsx`), `components/studio/**`, the **shared** generation components `components/generations/**` and their hooks/helpers `lib/generations/**`, dictionary `lib/i18n/messages/studio.ts` (namespace `studio`, with the shared sub-tree `studio.generations.*`: kind, status, card, progress, cancel/delete dialogs, failure reasons, actions, viewer, toasts).
The page parses the query with `parsePrefill`, calls `await requireUser(studioHref(prefill))` (so a logged-out visit to `/studio?tool=...` comes back after login) and renders `<Studio prefill />`; it renders no `<main>` (the shell has it) and one sr-only `h1`.

**Linking into the studio (gallery, explore, docs).** `studioHref({ tool?, modelId?, prompt?, inputAssetId? })` from `components/studio/prefill.ts` is the only builder of `/studio?tool=&model=&prompt=&input=`; `parsePrefill(searchParams)` is the only reader. Everything is untrusted and dropped when invalid (unknown tool, model id > 100 chars, prompt cut at 4000, `input` must be a valid `ast_` id and is ignored for text tools; a model alone implies its first tool, an input alone implies `image-to-image`).
`?input=<assetId>` is attached **without re-upload**: the preview is `GET /media/<id>` and the id goes into the request as it is (the studio does not know the asset's type). If the engine refuses it (a video asset, say) the studio copies a picture of it once (`recover`: the file, else its still thumbnail, uploaded as a new input) and retries; a 404 is shown under the input area, never silently. A different link while the studio is mounted is applied again (`prefillKey` tells "same request" from "new request"); the one-shot `prompt` and `input` are removed from the address bar after they are applied, while `tool` and `model` stay in sync with the form.
Example: a gallery "Animate" button is `<Link href={studioHref({ tool: 'image-to-video', inputAssetId: asset.id })}>`.

**Shared components (`components/generations`, barrel `index.ts`, all `'use client'`, props documented in the file headers).**
`GenerationCard({ generation, modelLabel?, demo?, handlers?, pending?, ref?, className? })` is the card of every state: queued/processing (shimmer, progress, elapsed time, Cancel), succeeded (1-4 results in a grid, video badge with duration), failed/canceled (reason from `error.code`, "Try again", "credits were refunded"); footer: prompt (2 lines, `dir="auto"`), model, credits, relative time, favorite and the menu. The `<article>` has `tabIndex=-1` and an accessible name (kind, prompt, status) so a page can focus it. The card shows an action only when its handler exists:
`GenerationHandlers = { onOpen(g, index), onToggleFavorite(g), onTogglePublic(g), onCopyLink(g), onCancel(g), onDelete(g), onReuse(g), onRetry(g), onUseAsInput(g, outputIndex) }` (`lib/generations/handlers.ts`).
`MediaPreview({ asset, alt, variant: 'thumb'|'full', fit, aspect?, natural?, controls?, eager? })` renders image / real video / animated GIF (the Demo video is `image/gif` with `kind: 'video'` and is drawn as `<img>`; with reduced motion a thumbnail stays a still), reserves its box before loading, falls back to a quiet message on load errors.
`MediaViewer({ generation, index, onIndexChange, onClose, handlers?, modelLabel? })` is the lightbox (Dialog-based: focus trap, Esc, arrows that mirror in RTL, zoom, download, favorite, share, menu). `GenerationActions({ generation, handlers?, size? })` is the menu (`canUseAsInput(g)` says whether "use as input" applies). `GenerationConfirm({ confirmation, onConfirm, onDismiss })` renders the cancel/delete `alertdialog` from `useGenerationActions().confirmation`.
`StatusBadge({ status })`, `Masonry({ items, getKey, estimateHeight, renderItem, minColumnWidth?, gap?, maxColumns? })` (columns follow the list's own width via ResizeObserver; a card keeps its column once placed, `assignColumns` in `lib/generations/masonry.ts`; use `estimateCardHeight` from `lib/generations/media.ts` as `estimateHeight`).

**Shared hooks and helpers (`lib/generations`).**
- `useGenerationPolling({ generations, onUpdate, onGone?, onView?, notify?, tuning? })`: pass everything on screen; the queued/processing ones are fetched with ONE `GET /generations?ids=a,b,c` (<= 50 per request, chunked). Delay 1.5 s after a change, x1.5 up to 4 s while nothing changes (`DEFAULT_POLLING`); failed requests and `retryAfterSec` back off; paused while the tab is hidden and run at once on visibility/focus; a 401 stops the loop and calls `useUser().refresh()`; ids the server no longer returns go to `onGone`. When a generation reaches a final state: toast (ready with a "View" action when `onView` is given, or the failure reason) and `useUser().refresh()` (a failure refunded credits). Timers, the in-flight request and listeners are released when the active set changes or on unmount; the effect depends on the sorted active ids, not on object identity.
- `useGenerationActions({ onChange, onRemove })` returns `{ handlers (favorite, share, copy link, cancel, delete), confirmation, confirm, dismiss }`: favorite/share are optimistic with rollback and a per-id pending set, cancel asks first only while processing, delete always asks, credits movement refreshes the balance, copy link uses `shareHref` = `/s/<id>`.
- `api.ts` (typed calls: `fetchModels`, `fetchGenerationPage`, `fetchGenerationsByIds`, `createGeneration` with the `Idempotency-Key` header, `cancelGeneration`, `updateGeneration`, `deleteGeneration`, `enhancePrompt`), `upload.ts` (`imageFileProblem`, `uploadImage` over XHR for progress/abort; png/jpeg/webp, <= 10 MiB, errors mapped to `ApiError`), `adopt.ts` (`usableAsInputDirectly`, `copyAssetAsInput`: an image output goes as `inputAssetId` as it is, a video result is copied from its still thumbnail), `errors.ts` (`failureReason`, `validationFields`, `retryAfterSeconds`, `isModelUnavailable`), `media.ts`/`format.ts` (presentation, aspect, `creditsText`, `formatElapsed`, `isolateLtr` for Latin runs inside Arabic), `use-now.ts` (one shared minute clock for all cards), `use-media-query.ts`, `download.ts`.
All server error codes reach the user as translated text (`errorMessage` plus `studio.submit.*`: `service_busy` and `rate_limited` show the `retryAfterSec` countdown, `email_not_verified` explains, `conflict` with `details.reason: 'model_unavailable'` refreshes the catalog); `details.path` of a 422/404 is mapped to the field it belongs to (prompt, negative prompt, seed, strength, input image) and shown under it.

**The studio (`components/studio`).**
- *State.* `form.ts` is a pure reducer (`studioReducer`, `reconcile`, `pickModel`, `buildRequest`, `formProblems`, `costOf`, `showsAspect`): the form (prompt, negative prompt, seed as typed, public flag) is shared by the tabs while the per-tool settings (model, aspect, count, duration, resolution, strength) are saved per tool and restored when its tab is selected again; picking a model reconciles every setting to what that model supports (aspect, count, duration and resolution fall back to the model's defaults; seed/negative/strength are dropped when unsupported). `costOf` calls `computeCost` from the catalog, so the price on the button, the `POST` body check and the server agree (a test walks the whole catalog against `validateForModel`). Only options the model supports are sent; for `followsInputAspect` models the aspect picker is hidden and `aspectRatio` is omitted.
- *Persistence.* `settings-storage.ts`: `localStorage` key `aivore.studio.v1` (the last tool and, per tool, model, aspect, count, duration, resolution and strength; never the prompt, negative prompt, seed, public flag or any asset), validated field by field on load, every read/write inside try/catch (private mode, blocked storage, corrupt JSON all fall back to defaults).
- *Controller.* `use-studio.ts` wires `use-studio-form` (state, persistence, URL sync), `use-models` (`GET /models`, filtered by tool; unavailable models are shown disabled with "not configured", Demo flagged), `use-image-input` (accept/upload/adopt/recover/clear, progress, `?input=`), `use-prompt-tools` (enhance with Undo and the "translated" note, surprise me, localized examples), `use-generate` (optimistic card, error mapping, idempotency) and `use-generation-feed` (the history: `GET /generations?limit=24`, "Load more" by cursor, add/settle/drop/update/remove) with `useGenerationPolling` and `useGenerationActions`.
- *Generate flow.* One `Idempotency-Key` (`crypto.randomUUID`, fallback for old browsers) per click; a retry of the SAME attempt after a network error/timeout re-sends the same key and body (a replay answers 200 with the same generation, so credits are never taken twice); any edit or a new click starts a new attempt. The optimistic card appears at once (`pending`) and is replaced by the server's copy. 401 sends the user to `/login?next=<studio url>`. Insufficient credits is decided before sending (button disabled, `CreditNotice` with "Get credits" -> `/pricing`) and again if the server says so (the balance is refreshed). After a submit the new card is scrolled into view; when the submit was made with the keyboard (Enter/Space on the button, or Ctrl/Cmd+Enter in the prompt) focus also moves to the card, whose name says what it is, so a screen-reader user lands on the result; a mouse click never takes focus away.
- *Layout.* >= 1024 px: left control panel (own scroll, sticky `GenerateBar` with cost, balance and button) and the canvas on the right; below it the canvas comes first with a bottom composer (prompt, enhance, surprise, Generate) and a "Settings" `Sheet` holding model, options, image and advanced; all logical properties, verified mirrored in Arabic. The example grid of the empty canvas uses a container query (one column when the canvas is narrow).
- *Accessibility.* tool tabs are a real `tablist` (arrows, Home/End, `aria-controls` panels) synced to `?tool=`; every control is labelled; the dropzone is a button reachable by keyboard and also accepts paste and drop; a polite status region says "generation started", the toasts (live regions of the `Toaster`) say ready/failed, field errors are `role="alert"` and linked with `aria-describedby`, and the running card's progress is plain text that is not read out on every tick; `prefers-reduced-motion` stops shimmer and GIF previews; axe runs in the component tests (light and Arabic).

**Behaviours worth knowing.** Output images are valid `inputAssetId`s (use as input = no copy); a video result is not, so its still thumbnail is uploaded again. A generation canceled while `processing` or failed is refunded in full by the server and the balance in the header updates on its own. Public (shared) is off by default and toggles per card. Nothing in the studio writes to the server except `POST /generations`, `POST /uploads`, `POST /prompt/enhance`, `POST /generations/<id>/cancel`, `PATCH/DELETE /generations/<id>`.

**Tests (`tests/components/{studio,generations}`, 21 files, 326 tests, no network).** `generations/support.tsx` has fixtures (`assetDTO`, `generationDTO`, `modelDTO`, `DEMO_IMAGE`, `DEMO_VIDEO`, `FLUX_UNAVAILABLE`, `EDIT_MODEL`), an in-memory fake API (`installFakeApi`: models, create/cancel/patch/delete, `?ids=`, cursors, enhance; `intercept` to force errors) and a fake XHR (`installFakeUploads`); `studio/support.tsx` adds `mountStudio({ desktop, locale, prefill, prepare, ... })`. Covered: the form state machine per tool, cost parity with `computeCost` over the catalog, insufficient-credits gating, aspect hidden for `followsInputAspect`, upload validation and progress, error mapping per code, idempotency-key reuse and renewal, polling with fake timers (backoff, visibility pause/resume, terminal stop, 404/network errors, 401, cleanup, > 50 ids), card/menu/viewer actions and focus handling, storage failures, prefill parsing, and i18n parity (same keys and placeholders in ar/en, every used key exists, no dead keys). **Additive only:** nothing outside the owned directories was changed; no schema, dependency or shared-contract change.
