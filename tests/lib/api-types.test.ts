import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ASSET_ROLES,
  GENERATION_STATUSES,
  LEDGER_REASONS,
  USER_ROLES,
  isTerminalStatus,
  type ApiErrorBody,
  type CreateGenerationRequest,
  type GenerationDTO,
  type GenerationStatus,
  type ModelDTO,
  type Page,
  type UserDTO,
} from '@/lib/api-types';
import type { ModelSpec } from '@/lib/catalog/types';
import type { AnyErrorCode } from '@/lib/errors';
import type { Locale } from '@/lib/i18n';
import type { CreateGenerationInput } from '@/lib/validation/generation';

describe('enumerations', () => {
  it('lists the documented values', () => {
    expect(GENERATION_STATUSES).toEqual([
      'queued',
      'processing',
      'succeeded',
      'failed',
      'canceled',
    ]);
    expect(USER_ROLES).toEqual(['user', 'admin']);
    expect(ASSET_ROLES).toEqual(['input', 'output']);
    expect(LEDGER_REASONS).toEqual([
      'signup_bonus',
      'generation',
      'refund',
      'admin_grant',
      'purchase',
      'adjustment',
    ]);
  });

  it('knows which statuses are final', () => {
    const terminal = GENERATION_STATUSES.filter((status) => isTerminalStatus(status));
    expect(terminal).toEqual(['succeeded', 'failed', 'canceled']);
  });
});

// These assertions are checked by `tsc` (npm run typecheck); at runtime they are no-ops.
describe('type contracts', () => {
  it('matches the shapes in ARCHITECTURE.md', () => {
    expectTypeOf<GenerationDTO['status']>().toEqualTypeOf<GenerationStatus>();
    expectTypeOf<UserDTO['locale']>().toEqualTypeOf<Locale>();
    expectTypeOf<Page<string>>().toEqualTypeOf<{ data: string[]; nextCursor: string | null }>();
    expectTypeOf<ApiErrorBody['error']['code']>().toEqualTypeOf<AnyErrorCode>();
    expectTypeOf<ModelDTO>().toMatchTypeOf<Omit<ModelSpec, 'provider' | 'providerModel'>>();
    expectTypeOf<ModelDTO['available']>().toEqualTypeOf<boolean>();
  });

  it('keeps the request type and the zod schema in sync', () => {
    expectTypeOf<CreateGenerationInput>().toEqualTypeOf<CreateGenerationRequest>();
  });
});
