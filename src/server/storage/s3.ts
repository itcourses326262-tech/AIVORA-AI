// OWNER: storage — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { Env } from '@/server/env';
import type { StorageDriver } from './types';

/** S3-compatible object storage configured from the `S3_*` variables (validated by `getEnv()`). */
export function createS3Storage(_env: Env): StorageDriver {
  throw new NotImplementedError('storage.createS3Storage');
}
