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
  comments only for non-obvious *why*. Prettier + ESLint clean.

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
TRUST_PROXY=false                          # honour X-Forwarded-For for the client IP (only behind a proxy you control)
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
    security/{rate-limit.ts,origin.ts,ssrf.ts,ip.ts,headers.ts}
    credits/index.ts
    moderation/index.ts
    prompt/{enhancer.ts,heuristic.ts}
    providers/{types.ts,errors.ts,registry.ts,http.ts,mock/**,openai/**,fal/**,replicate/**}
    storage/{types.ts,index.ts,local.ts,s3.ts}
    uploads/{index.ts,sniff.ts,image.ts}
    generations/{service.ts,lifecycle.ts,dto.ts,queries.ts}
    jobs/{runner.ts,worker.ts,start.ts}
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
- `generations`: `id, userId, tool, kind ('image'|'video'), modelId, provider, status ('queued'|'processing'|'succeeded'|'failed'|'canceled'), prompt, negativePrompt?, params (json: GenerationParams), inputAssetId?→assets, cost (int), progress (0–100), providerJobId?, providerMeta (json?), errorCode?, errorMessage?, attempts (int), workerId?, leaseUntil?, idempotencyKey? (unique per user), isPublic (bool), isFavorite (bool), createdAt, updatedAt, startedAt?, finishedAt?`; indexes: `(userId, createdAt desc)`, `(status, leaseUntil)`, `(isPublic, createdAt desc)`, unique `(userId, idempotencyKey)`.
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
  status: GenerationStatus; progress: number; cost: number; error?: { code: string; message: string };
  outputs: AssetDTO[]; input?: AssetDTO; isPublic: boolean; isFavorite: boolean;
  createdAt; startedAt?; finishedAt?; owner?: { name: string } /* only on public feeds */ }
interface ModelDTO extends Omit<ModelSpec,'provider'|'providerModel'> { provider: ProviderId; available: boolean; unavailableReason?: 'not_configured' }
interface LedgerEntryDTO { id; delta; balanceAfter; reason; generationId?: string; note?: string; createdAt }
interface ApiKeyDTO { id; name; prefix; createdAt; lastUsedAt?: number; revokedAt?: number }
interface Page<T> { data: T[]; nextCursor: string | null }
// Envelope: success → { data: T } (lists: { data: T[], nextCursor }), error → { error: { code, message, details? } }
interface CreateGenerationRequest { tool; modelId; prompt; negativePrompt?; params?: Partial<GenerationParams>; inputAssetId?; isPublic? }
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
(`ids=a,b`); aborts are rethrown untouched; a dropped connection is `ApiError('network_error', status 0)`; a body that is not the
expected envelope is `invalid_response`; unknown server codes are replaced by `codeForStatus(status)`. `ApiError.code` is always an
`AnyErrorCode`, so ``t(`errors.${error.code}`)`` is type-safe.

### Errors — `src/lib/errors.ts`

`AppError(code, status, message, details?)` with codes → default status:
`bad_request 400, validation_failed 422, unauthorized 401, forbidden 403, not_found 404, conflict 409,
payload_too_large 413, unsupported_media_type 415, moderation_blocked 422, insufficient_credits 402,
rate_limited 429, too_many_active 429, signup_disabled 403, provider_error 502, internal 500`.
UI maps `code` → localized text via `errors.<code>` i18n keys (API `message` is English). As built: the constructor is exactly
`new AppError(code, status, message, details?, { cause }?)`; `AppError.of(code, message, details?)` uses the default status
(`ERROR_STATUS[code]`). `NotImplementedError extends AppError` (`internal`, 501). The browser-only codes `network_error` and
`invalid_response` (`CLIENT_ERROR_CODES`) plus `AnyErrorCode`, `isErrorCode`, `errorCodeOf(unknown)` and `codeForStatus(status)`
live in the same file; the `errors` message namespace must contain every `AnyErrorCode` plus `unknown` (enforced by `satisfies`).

### i18n — `src/lib/i18n/*`

- Locales `'ar' | 'en'`; `dir = ar ? 'rtl' : 'ltr'`. Resolution: cookie `aivore_locale` → `Accept-Language` → **`ar`** fallback.
- Dictionaries are split per namespace in `messages/<ns>.ts`, each `export default defineMessages({ en: {...}, ar: {...} })`
  where the type system **forces identical key shapes** for both languages. Nested objects, dotted `t('studio.generate')`,
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
route<P = Record<string, never>>(opts: { auth: 'required'|'optional'|'none'; rateLimit?: { name: string; limit: number; windowSec: number; by?: 'ip'|'user' };
                 admin?: boolean; csrf?: boolean /* default: true for non-GET with cookie auth */; maxBodyBytes?: number /* default 1 MiB */ },
         handler: (ctx: RouteCtx<P>) => Promise<Response | unknown>): (req: Request, nextCtx?: { params: Promise<P> }) => Promise<Response>
// Overloaded: with auth:'required' the handler receives AuthedRouteCtx<P> (auth: AuthContext, never null).
// RouteCtx: { req; params: P; auth: AuthContext | null (non-null when 'required'); ip: string; requestId: string;
//             body<T>(schema: ZodType<T>): Promise<T>  /* size-limited JSON, ValidationError → 422 with details */;
//             query<T>(schema: ZodType<T>): T }
// Handler may return a Response, or a plain value (→ 200 {data}). Helpers: ok(data, init?), created(data), page(rows, nextCursor), noContent().
// Wrapper: request-id header, catches AppError/ZodError/unknown → envelope, logs 5xx, applies rate limit & origin check via security/*,
// sets `Cache-Control: no-store` on API responses by default.
// As built: request id = a sane inbound `X-Request-Id` or a UUID, echoed on every response. `undefined` return → 204. Order:
// getClientIp → IP rate limit (before auth, so floods never reach the credential lookup) → authenticate (only when the request
// carries an Authorization header or the `aivore_session` cookie, so anonymous calls never touch the DB; 'none' never calls it)
// → admin check (403) → assertSameOrigin (mutating methods, when `csrf ?? auth.via==='session'`; pass `csrf: true` on login/register)
// → per-user rate limit → handler. A rate-limit rejection is 429 + `Retry-After`; `X-RateLimit-Limit/Remaining/Reset` are sent whenever a
// limit applies. `admin: true` without `auth: 'required'` throws when the route module loads. 5xx are logged at error (with the error,
// never the query string or credentials), everything else at debug. Unknown errors and `internal` AppErrors reach the client as
// `{ error: { code: 'internal', message: 'Internal server error' } }`.
// Helpers (server/http): respond.ts `ok/created/accepted/page/noContent/json`; errors.ts `validationError/normalizeError/errorResponse`;
// request.ts `readJsonBody/queryObject/parseOrThrow/pageQuerySchema ({limit 1-100 default 20, cursor})/hasCredentials/requestIdOf`.
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
security/origin.ts: assertSameOrigin(req) for cookie-authenticated mutating requests (Origin/Referer vs APP_URL/host; API-key requests exempt)
security/ssrf.ts: assertPublicHttpsUrl(url): resolves DNS, blocks private/loopback/link-local/metadata ranges, blocks redirects to them; safeFetch(url, {maxBytes, timeoutMs, allowedContentTypes})
security/ip.ts: getClientIp(req) (X-Forwarded-For only when TRUST_PROXY=true)
security/headers.ts: baseline security headers object used by next.config.ts (CSP, HSTS in prod, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors)
```

Routes: `POST /auth/register|login|logout`, `GET /auth/me`, `GET|PATCH /account`, `POST /account/password`,
`GET /account/ledger`, `GET|POST /keys`, `DELETE /keys/:id`.

As built (stubs, see §15): everything is imported from `@/server/auth` (a barrel over `context.ts` (`SessionUser`, `AuthContext`,
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
listLedger(dbOrTx, userId, { limit?; cursor? }): Page<LedgerEntryDTO>           // newest first; limit 1-100 (default 20)
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
  keep those export names. Until the real adapters exist the three real stubs report `isConfigured() === false`, so no model is offered through them.

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
GET /api/v1/media/:assetId[?variant=thumb] — access: owner (session or API key) OR generation.isPublic; Range support (206) for video; ETag; Cache-Control private vs public; `X-Content-Type-Options: nosniff`; Content-Disposition inline (or attachment with ?download=1); for S3 either stream or 302 to short-lived signed URL
POST /api/v1/uploads (multipart `file`) → { data: AssetDTO }
```

As built (stubs, see §15): `storage/types.ts` (real) exports `StorageDriver`, `StorageRange`, `StorageReadResult`, `StoredObjectInfo` and
`STORAGE_KEY_PATTERN`. `storage/index.ts` is real wiring: `getStorage()` (lazy, kept on `globalThis`, chosen by `STORAGE_DRIVER`) and
`setStorageOverride(driver | null)` for tests; it calls the stubs `createLocalStorage(rootDir)` (`local.ts`) and `createS3Storage(env)` (`s3.ts`).
`uploads/index.ts`: `acceptUpload(file, userId): Promise<AssetRecord>` (`AssetRecord = AssetRow`),
`persistOutput(storage, { userId, generationId, index, kind, bytes, mimeType, durationMs?, width?, height? }): Promise<PersistedOutput>` where
`PersistedOutput = { assetId, index, kind, storageKey, thumbKey?, mimeType, bytes, width?, height?, durationMs?, sha256? }`, and
`removeAssetObjects(storage, assets)` (best effort, for deletes). `uploads/sniff.ts`: `sniffImageType(bytes)`, `extensionForMime`, `UPLOAD_MIME_TYPES`;
`uploads/image.ts`: `normalizeUpload`, `probeImage`, `makeThumbnail`. `toAssetDTO(row)` lives in `generations/dto.ts` (real).

### 6.6 `server/generations` + `server/jobs` (owner `engine`)

```ts
// service.ts (called by routes)
createGeneration(userId, req: CreateGenerationRequest, opts?: { idempotencyKey?: string }): Promise<{ generation: GenerationDTO; created: boolean }>
   // validate (lib/validation) → moderation → ensure model available → input asset owned by user → active-limit → cost
   // → ONE sync DB tx: debit credits + insert generation('queued') (idempotency key returns existing) → wake worker
getGeneration(userId, id) / listGenerations(userId, { kind?, status?, favorite?, q?, ids?, limit, cursor? }) / listPublicGenerations({ kind?, limit, cursor? })
updateGeneration(userId, id, { isPublic?, isFavorite? }) / deleteGeneration(userId, id) / cancelGeneration(userId, id)  // cancel: queued|processing → canceled + refund
getPublicGeneration(id): GenerationDTO | null           // for /s/[id]
// lifecycle.ts (used by runner; all state changes are compare-and-set, sync tx)
claimNextJob(workerId, leaseMs): GenerationRow | null              // BEGIN IMMEDIATE; queued (or expired-lease processing) → processing, attempts++
extendLease(id, workerId, leaseMs): boolean
recordSubmitted(id, workerId, providerJobId, meta): boolean
updateProgress(id, workerId, progress): void
completeGeneration(id, workerId, outputs: PersistedOutput[]): boolean   // processing→succeeded; inserts asset rows; partial refund if fewer outputs than count
failGeneration(id, workerId|null, error: { code; message }): boolean    // processing|queued→failed + full refund (idempotent)
requeueStale(): number                                                   // expired leases → queued, or failed+refund when attempts ≥ MAX_ATTEMPTS
// runner.ts
class JobRunner { constructor(deps: { db; storage; providers; env; log; now? }); start(); stop(): Promise<void>; wake(); tick(): Promise<number> }
   // loop: claim up to WORKER_CONCURRENCY jobs; processJob is RESUMABLE (providerJobId present → straight to polling);
   // heartbeat extends lease every 15 s; poll backoff images 1→3 s, video 3→10 s (jittered); timeout per kind;
   // retryable submit errors retried with backoff ≤ MAX_ATTEMPTS; between polls re-read status: if canceled → provider.cancel (best effort) and stop;
   // outputs: url → safeFetch (SSRF-safe, size cap 500 MB) → storage.put → sharp probe + thumb → completeGeneration; any error → failGeneration (refund)
start.ts: startWorker() singleton on globalThis (HMR-safe); instrumentation.ts calls it only when NEXT_RUNTIME==='nodejs' && WORKER_MODE==='inline'
scripts/worker.ts: standalone entry for WORKER_MODE=external (graceful SIGTERM)
```
As built (stubs, see §15): the `lifecycle.ts` functions take the connection first, like the credits functions
(`claimNextJob(db, workerId, leaseMs, now?)`, `extendLease(db, id, workerId, leaseMs, now?)`, `recordSubmitted(db, id, workerId, providerJobId, meta?)`,
`updateProgress(db, id, workerId, progress)`, `completeGeneration(db, id, workerId, outputs: PersistedOutput[])`,
`failGeneration(db, id, workerId | null, error)`, `requeueStale(db, now?)`), and stay synchronous. `service.ts` functions are async except
`getPublicGeneration`; `listGenerations(userId, ListGenerationsQuery)` and `listPublicGenerations({ kind?, limit?, cursor? })` return `Page<GenerationDTO>`;
`updateGeneration(userId, id, UpdateGenerationRequest)` and `cancelGeneration` return the `GenerationDTO`. `queries.ts` (`findGenerationRow`,
`findOwnedGenerationRow`, `countActiveGenerations`, `hydrateGenerations`) is internal to the engine. `dto.ts` is real: `toGenerationDTO(row, { outputs, input?, owner? })`
never exposes provider, provider job id/meta, worker, lease, attempts, idempotency key or owner id. `JobRunnerDeps = { db, storage, providers: { getProvider }, env, log, now? }`;
`jobs/worker.ts` `createJobRunner(overrides?)` and `jobs/start.ts` `startWorker()` / `stopWorker()` are real wiring over the stub `JobRunner`.

Routes: `POST|GET /generations`, `GET|PATCH|DELETE /generations/:id`, `POST /generations/:id/cancel`, `GET /explore` (public feed, no auth).
`GET /generations?ids=a,b,c` supports cheap batch polling by the UI (UI polls active ones every 1.5–4 s with backoff and pauses when the tab is hidden).
`Idempotency-Key` header on `POST /generations`.

### 6.7 `server/moderation`, `server/prompt` (owner `catalog`)

```ts
moderatePrompt(text: string, opts?): Promise<{ allowed: boolean; category?: string; reason?: string }>  // built-in conservative multilingual (en+ar) blocklist + MODERATION_BLOCKLIST + optional OpenAI moderation; fail-open ONLY for the remote check, never for the local list
enhancePrompt({ prompt, kind, locale? }): Promise<{ prompt: string; engine: 'openai'|'anthropic'|'heuristic'; translated: boolean }>
   // LLM path: translate Arabic→English when the target models are English-centric + enrich (subject, style, lighting, composition); returns ONLY the prompt; heuristic path appends tasteful descriptors, never calls network
```
`lib/validation/generation.ts`: `validateGenerationRequest(req, env?) → { ok: true; model; params /* normalized */; cost } | { ok: false; errors }` – checks tool/model compatibility, prompt length, allowed aspect ratio/duration/resolution/count, requires `inputAssetId` iff tool needs an image, clamps defaults.

As built (stubs, see §15): `moderatePrompt(text, { signal?, fetch? }): Promise<{ allowed; category?; reason? }>`;
`enhancePrompt(EnhancePromptRequest, { env?, fetch?, signal? }): Promise<EnhancePromptResponse>` and the sync
`enhanceHeuristically(EnhancePromptRequest): EnhancePromptResponse` (`prompt/heuristic.ts`). `lib/validation/generation.ts` keeps the real zod
schema and adds the stub `validateGenerationRequest(request, env?: { ENABLE_MOCK_PROVIDER?: boolean }): GenerationValidationResult`, i.e.
`{ ok: true; model; params; cost } | { ok: false; errors: ValidationIssue[] }` (the structural `env` type keeps `lib/` free of server imports; pass `getEnv()`).

## 7. HTTP API (v1) — summary

Base `/api/v1`. Auth: session cookie (UI) **or** `Authorization: Bearer avk_…` (developers). JSON envelope. Cursor pagination.

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| POST | `/auth/register` `/auth/login` `/auth/logout` | none/required | sets/clears cookie |
| GET | `/auth/me` | optional | `{data: UserDTO|null}` |
| GET PATCH | `/account` | required | name, locale |
| POST | `/account/password` | required | |
| GET | `/account/ledger` | required | paginated |
| GET POST | `/keys` · DELETE `/keys/:id` | session only | key returned once |
| GET | `/models` `/tools` | optional | availability + pricing |
| POST | `/prompt/enhance` | required | |
| POST | `/uploads` | required | multipart |
| GET | `/media/:assetId` | optional | owner or public |
| POST GET | `/generations` | required | Idempotency-Key |
| GET PATCH DELETE | `/generations/:id` | required | |
| POST | `/generations/:id/cancel` | required | |
| GET | `/explore` | none | public feed |
| GET | `/openapi.json` | none | served from `public/openapi.json`-equivalent |
| GET | `/api/health` | none | bare (not enveloped) `HealthDTO` `{status:'ok', db:true, worker, version}`; `{status:'error', db:false, …}` with HTTP 503 when `SELECT 1` fails |

## 8. Generation lifecycle

```
POST /generations ─► validate ─► moderate ─► [tx: debit + insert queued] ─► 202/201 GenerationDTO(status=queued)
worker: claim (queued→processing, lease) ─► provider.submit ─► sync outputs | async providerJobId ─► poll … ─► download/persist outputs
      ─► completeGeneration (processing→succeeded)           | any failure/timeout ─► failGeneration (→failed + refund)
cancel: queued|processing → canceled + refund (runner notices on next poll → provider.cancel best-effort)
crash: lease expires → requeueStale → queued (resumes polling if providerJobId present) or failed+refund after MAX_ATTEMPTS
```
Terminal states are final. Every transition is a compare-and-set on `(id, status[, workerId])`. Refunds are
idempotent. A succeeded job never gets refunded (except proportional partial output shortfall).

## 9. Security requirements (non-negotiable)

- Authz on every object access (owner or public flag); IDOR tests for generations/assets/keys.
- CSRF: SameSite=Lax cookie + Origin check on mutating cookie-auth requests.
- No user-supplied URLs fetched server-side except provider output URLs through `safeFetch`; uploads only via multipart.
- Secrets never reach the client bundle or logs; API keys & session tokens only stored hashed.
- Rate limits (defaults): login 10/min per IP+email, register 5/h per IP, create generation 30/min per user, uploads 20/min, enhance 20/min, general 300/min.
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
  (ESLint forbids importing `gifenc` anywhere else); types live in `src/types/gifenc.d.ts`. `applyPalette` /
  `prequantize` need an RGBA array that owns its `ArrayBuffer` (`new Uint8Array(buffer)`, not a pooled `Buffer`).
- **Vitest**: `globals` are off (import `describe/it/expect` from `vitest`); node environment by default, files named
  `*.dom.test.tsx` run under jsdom with `@testing-library/jest-dom` matchers and automatic cleanup. `tests/setup.ts`
  forces `DATABASE_PATH=:memory:`, `WORKER_MODE=off`, local storage in the OS temp dir and removes provider keys.
  `server-only` and `@/*` are aliased. Tests live under `tests/` only (Playwright specs live in `e2e/`).
- **Lint**: `export default` is an error except in Next-required files, `*.config.*`, `lib/i18n/messages/*.ts` and
  `src/types/**/*.d.ts`; `import type` is enforced; unused names must start with `_`.
- **Playwright**: the pre-installed Chromium (`/opt/pw-browsers/chromium-*`) is older than the one Playwright pins, so
  the config launches it via `executablePath` (override with `PW_CHROMIUM_PATH`, port with `PW_PORT`, default 3200).
  The web server is production mode with a scratch DB/media dir under the OS temp dir.
- **Standalone output**: `next build` emits `.next/standalone/server.js`; `better-sqlite3`, `sharp` and `gifenc` are
  traced into it once imported by server code. `next start` still works but prints a warning; Docker should run
  `node server.js` and copy `.next/static` and `public/` next to it.
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
  key. All problems are reported together in one `EnvError` (`problems: string[]`). `TRUST_PROXY` (default false) was added.
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
- **Stubs created by the kernel step** (owner `auth-security`, replace fully, keep these exports because `route()` imports them):
  `server/auth` (`SessionUser`, `AuthContext`, `authenticate(req)`, still exported from the `@/server/auth` barrel); `server/security/rate-limit.ts` →
  `RateLimitResult`, `RateLimiter`, `getRateLimiter()`; `server/security/origin.ts` → `assertSameOrigin(req): void`; `server/security/ip.ts` →
  `getClientIp(req): string` (the stub always returns `'unknown'`). `SESSION_COOKIE_NAME` is exported by `server/http/request.ts`. The rest of the stubs are listed in §15.
- **Test helpers** (`tests/helpers`; the HTTP, factory and fake helpers are described in §15): `db.ts` (`createTestDb({ file? })` → `{ db, path, close }`, fully migrated; `seedUser`; `freshDb()`),
  `credits.ts` (`ledgerInOrder`, `expectConsistentLedger` — the balance/chain invariants), `model-spec.ts` (`modelSpecProblems(model)`;
  provider owners should assert it is `[]` for the models they add), and two child-process workers (`credits-race-worker.ts`,
  `migrate-worker.ts`) run with `node --import tsx --conditions=react-server`. better-sqlite3 is synchronous, so only separate
  processes can race; see `tests/server/credits/race.test.ts` for the pattern. Route tests mock `@/server/auth` and
  `@/server/security/*` (see `tests/server/http/route.test.ts`).

## 15. Stubs, test helpers and app shell (as built)

**Stub files.** Each starts with `// OWNER: <key> — replace this stub`, keeps the exact exports below, and throws `NotImplementedError` from
`@/lib/errors` (types, interfaces, constants and error classes are real). The owner replaces the whole file and may add exports, not remove them.
Files marked *real* are finished wiring or contracts and carry a different `// OWNER:` header.

| Owner | Files |
| ----- | ----- |
| `auth-security` | `server/auth/{context,users,sessions,api-keys,cookies,password}.ts`, `server/security/ssrf.ts`, `scripts/admin.ts` (stubs); `server/auth/tokens.ts` (*real*, storage contract); `server/auth/index.ts` (*real* barrel); `server/security/{rate-limit,origin,ip}.ts` (kernel stubs) |
| `providers-mock` | `server/providers/{types,errors,http,registry}.ts` (*real*), `server/providers/mock/index.ts` (stub, exports `mockProvider`; `isConfigured` is `env.ENABLE_MOCK_PROVIDER`) |
| `provider-openai`, `provider-fal`, `provider-replicate` | `server/providers/{openai,fal,replicate}/index.ts` (stubs exporting `openaiProvider`, `falProvider`, `replicateProvider`; `isConfigured` is always false) |
| `storage` | `server/storage/{local,s3}.ts`, `server/uploads/{index,sniff,image}.ts` (stubs); `server/storage/{types,index}.ts` (*real*) |
| `engine` | `server/generations/{service,lifecycle,queries}.ts`, `server/jobs/runner.ts` (stubs); `server/generations/dto.ts`, `server/jobs/{worker,start}.ts`, `instrumentation.ts` (*real*); `scripts/worker.ts` (wiring done, runs the stub runner) |
| `catalog` | `server/moderation/index.ts`, `server/prompt/{enhancer,heuristic}.ts` (stubs), `validateGenerationRequest` in `lib/validation/generation.ts` (stub next to the real schema) |

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
  dynamic. It provides `I18nProvider`, a localized skip link (`common.a11y.skipToContent`) and `generateMetadata`/`viewport`. **Every page or layout must render exactly one
  `<main id="main-content">`**, the skip link's target. Theme and locale switchers write the cookies and refresh.
- `app/globals.css` (ui-kit extends it): imports Tailwind and the self-hosted `@fontsource-variable/{inter,cairo}` (families `Inter Variable`, `Cairo Variable`; the build emits woff2 per unicode-range
  subset, including `cairo-arabic`), defines `--background/--foreground/--muted/--ring` for `:root[data-theme=dark|light]` and `data-theme=system` (via `prefers-color-scheme`) and maps them to
  Tailwind colors (`bg-background`, `text-foreground`, `text-muted`). Arabic pages get Cairo first.
- `app/(marketing)/page.tsx` is the placeholder landing page (name and tagline in the active locale). `src/app/page.tsx` no longer exists; ui-kit replaces the placeholder in place.
- `app/api/health/route.ts` (real): bare `HealthDTO`, `SELECT 1` against the database, `worker` = `WORKER_MODE`, `version` from `lib/version.ts` (package.json inlined at build time). 503 when the database fails.
- `instrumentation.ts` (real): in the Node.js runtime with `WORKER_MODE=inline` it dynamic-imports `server/jobs/start` and calls `startWorker()`; any failure (bad env, stub runner) is logged at error
  and swallowed, so the app always boots. Verified: with the stub runner and `WORKER_MODE=inline` the server logged the `NotImplementedError` and still served `/` and `/api/health`.
- Verified on the production build: `/api/health` returns `{"status":"ok","db":true,"worker":"off","version":"0.1.0"}`; `/` renders `<html lang="ar" dir="rtl">` for `Accept-Language: ar` or no header,
  `lang="en" dir="ltr"` for `en`, a locale cookie beats the header, and `aivore_theme=light` renders `data-theme="light"`.
