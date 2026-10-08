/**
 * Variables that authorise or select a real external service, or grant privileges. A developer's
 * shell, `.env` or `.env.local` may set any of them, and no automated run may inherit them: unit
 * tests delete them (`tests/setup.ts`) and the e2e web server blanks them (`playwright.config.ts`;
 * a blank value counts as unset in `server/env.ts` and, being defined, stops Next from loading the
 * dotenv value). Keep this list in step with `.env.example`.
 */
export const ISOLATED_ENV_KEYS = [
  'OPENAI_API_KEY',
  'FAL_KEY',
  'REPLICATE_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'ADMIN_EMAILS',
  'MODERATION_BLOCKLIST',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;
