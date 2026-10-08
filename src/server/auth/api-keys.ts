// OWNER: auth-security — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { ApiKeyDTO, CreateApiKeyResponse } from '@/lib/api-types';

/** Creates `avk_<prefix>_<secret>`. The full key is in the result once and never stored. */
export async function createApiKey(_userId: string, _name: string): Promise<CreateApiKeyResponse> {
  throw new NotImplementedError('auth.createApiKey');
}

/** The user's keys, newest first, including revoked ones. */
export async function listApiKeys(_userId: string): Promise<ApiKeyDTO[]> {
  throw new NotImplementedError('auth.listApiKeys');
}

/** Marks the key revoked. `not_found` when it does not exist or belongs to someone else. */
export async function revokeApiKey(_userId: string, _keyId: string): Promise<void> {
  throw new NotImplementedError('auth.revokeApiKey');
}
