import { AppError } from '@/lib/errors';
import { getEnv } from '@/server/env';
import { toAssetDTO } from '@/server/generations/dto';
import { created } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { acceptUpload } from '@/server/uploads';
import { UPLOAD_RATE_LIMIT } from './rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BYTES_PER_MB = 1024 * 1024;

/**
 * `POST /api/v1/uploads`: multipart form with exactly one `file` field (PNG, JPEG or WebP). The
 * body cap is the upload limit plus one MB of multipart framing, enforced while the body streams
 * in, so an oversized request is cut off instead of being buffered.
 */
export const POST = route(
  {
    auth: 'required',
    rateLimit: UPLOAD_RATE_LIMIT,
    maxBodyBytes: () => (getEnv().MAX_UPLOAD_MB + 1) * BYTES_PER_MB,
  },
  async (ctx) => {
    const fields = (await ctx.formData()).getAll('file');
    const [file] = fields;
    if (fields.length !== 1 || !(file instanceof File)) {
      throw new AppError('validation_failed', 422, 'Request validation failed', {
        issues: [{ path: 'file', message: 'Send exactly one file in the "file" field' }],
      });
    }
    return created(toAssetDTO(await acceptUpload(file, ctx.auth.user.id)));
  },
);
