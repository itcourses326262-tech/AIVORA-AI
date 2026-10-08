import 'server-only';
import { and, asc, eq, gt } from 'drizzle-orm';
import { getDb } from '@/server/db';
import {
  apiKeys,
  assets,
  creditLedger,
  generations,
  sessions,
  users,
  type AssetRow,
  type GenerationRow,
} from '@/server/db/schema';
import { getEnv } from '@/server/env';

/** Format identifier at the top of the file, bumped when the shape changes incompatibly. */
export const EXPORT_FORMAT = 'aivore-account-export/1';

const PAGE = 500;

function assetEntry(row: AssetRow, appUrl: string) {
  return {
    id: row.id,
    generationId: row.generationId,
    role: row.role,
    kind: row.kind,
    mimeType: row.mimeType,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sha256: row.sha256,
    createdAt: row.createdAt,
    // Downloadable with the same session (or API key) as any media URL.
    url: `${appUrl}/api/v1/media/${row.id}`,
    ...(row.thumbKey ? { thumbUrl: `${appUrl}/api/v1/media/${row.id}?variant=thumb` } : {}),
  };
}

/** What the person wrote and chose, not how we ran it: no provider ids, leases or worker names. */
function generationEntry(row: GenerationRow) {
  return {
    id: row.id,
    tool: row.tool,
    kind: row.kind,
    modelId: row.modelId,
    status: row.status,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    params: row.params,
    cost: row.cost,
    inputAssetId: row.inputAssetId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    isPublic: row.isPublic,
    isFavorite: row.isFavorite,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * Pages through `fetch` (keyset on the row id, so the memory stays bounded however much the user
 * made) and yields the rows as one JSON array, a row per line.
 */
async function* jsonArray<Row extends { id: string }>(
  fetch: (after: string) => Row[],
  map: (row: Row) => unknown,
): AsyncGenerator<string> {
  yield '[';
  let after = '';
  let first = true;
  for (;;) {
    const rows = fetch(after);
    const last = rows.at(-1);
    if (!last) break;
    after = last.id;
    for (const row of rows) {
      yield `${first ? '\n' : ',\n'}    ${JSON.stringify(map(row))}`;
      first = false;
    }
    if (rows.length < PAGE) break;
  }
  yield first ? ']' : '\n  ]';
}

/**
 * The user's data as a JSON document, in chunks: profile, sign-in sessions (no tokens), API key
 * metadata (never a secret or its hash), the full credit ledger, generations (what was asked and
 * the outcome) and every asset with its download URL. Every query is scoped to `userId`: this is
 * the whole access check, so the caller passes the authenticated id and nothing else.
 */
export async function* exportAccountChunks(
  userId: string,
  now: number = Date.now(),
): AsyncGenerator<string> {
  const db = getDb();
  const appUrl = getEnv().APP_URL;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return;

  yield `{\n  "format": ${JSON.stringify(EXPORT_FORMAT)},\n  "exportedAt": ${now},\n`;
  yield `  "profile": ${JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
    creditBalance: user.creditBalance,
    emailVerifiedAt: user.emailVerifiedAt,
    signupIp: user.signupIp,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  })},\n`;

  yield '  "sessions": ';
  yield* jsonArray(
    (after) =>
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.id, after)))
        .orderBy(asc(sessions.id))
        .limit(PAGE)
        .all(),
    (row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      userAgent: row.userAgent,
      ip: row.ip,
    }),
  );
  yield ',\n  "apiKeys": ';
  yield* jsonArray(
    (after) =>
      db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, userId), gt(apiKeys.id, after)))
        .orderBy(asc(apiKeys.id))
        .limit(PAGE)
        .all(),
    (row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }),
  );
  yield ',\n  "ledger": ';
  yield* jsonArray(
    (after) =>
      db
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.userId, userId), gt(creditLedger.id, after)))
        .orderBy(asc(creditLedger.id))
        .limit(PAGE)
        .all(),
    (row) => ({
      id: row.id,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      reason: row.reason,
      generationId: row.generationId,
      note: row.note,
      createdAt: row.createdAt,
    }),
  );
  yield ',\n  "generations": ';
  yield* jsonArray(
    (after) =>
      db
        .select()
        .from(generations)
        .where(and(eq(generations.userId, userId), gt(generations.id, after)))
        .orderBy(asc(generations.id))
        .limit(PAGE)
        .all(),
    generationEntry,
  );
  yield ',\n  "assets": ';
  yield* jsonArray(
    (after) =>
      db
        .select()
        .from(assets)
        .where(and(eq(assets.userId, userId), gt(assets.id, after)))
        .orderBy(asc(assets.id))
        .limit(PAGE)
        .all(),
    (row) => assetEntry(row, appUrl),
  );
  yield '\n}\n';
}
