import { exportAccountChunks } from '@/server/auth/account-export';
import { requireSession } from '@/server/auth/http';
import { AppError } from '@/lib/errors';
import { route } from '@/server/http/route';
import { ACCOUNT_EXPORT_RATE_LIMIT } from '../data-rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Roughly this many bytes are gathered before a chunk goes to the client. */
const CHUNK_BYTES = 64 * 1024;

/**
 * `GET /api/v1/account/export` -> the user's data as a JSON download (profile, sessions, API key
 * metadata without secrets, ledger, generations, assets with URLs). Session only, 3 a day. Streams
 * in pages, so an account with a huge history never sits in memory whole. Every row is selected by
 * the authenticated user's id; there is no id in the request to tamper with.
 */
export const GET = route(
  { auth: 'required', rateLimit: ACCOUNT_EXPORT_RATE_LIMIT },
  async (ctx) => {
    requireSession(ctx.auth);
    // A GET cannot be protected by the same-origin check, so a page on another site is refused
    // outright: it could otherwise spend the visitor's three exports.
    if (ctx.req.headers.get('sec-fetch-site') === 'cross-site') {
      throw AppError.of('forbidden', 'Cross-site requests are not allowed here');
    }

    const chunks = exportAccountChunks(ctx.auth.user.id);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let buffer = '';
        while (buffer.length < CHUNK_BYTES) {
          const next = await chunks.next();
          if (next.done) {
            if (buffer) controller.enqueue(encoder.encode(buffer));
            controller.close();
            return;
          }
          buffer += next.value;
        }
        controller.enqueue(encoder.encode(buffer));
      },
      async cancel() {
        await chunks.return(undefined);
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="aivore-export-${day}.json"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
);
