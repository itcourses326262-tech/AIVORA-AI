import { errorCodeOf } from '@/lib/errors';
import type { TFunction } from '@/lib/i18n';

/** Localized text for anything that was thrown (`ApiError`, `AppError`, unknown). */
export function errorMessage(t: TFunction, error: unknown): string {
  return t(`errors.${errorCodeOf(error)}`);
}
