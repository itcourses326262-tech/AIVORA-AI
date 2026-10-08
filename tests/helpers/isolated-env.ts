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
  // Email: configuring SMTP switches on mandatory address confirmation, which no automated run
  // may inherit from a developer's machine (nor may it send mail through their account).
  'SMTP_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
  'EMAIL_FROM',
  'EMAIL_VERIFICATION',
  'DISPOSABLE_EMAIL_DOMAINS',
  'SIGNUPS_PER_IP_PER_DAY',
  // Billing: a payment gateway key (or a webhook secret) must never come from a developer's
  // machine into a test run, and the gateway choice must be the default (the fake) there.
  'BILLING_GATEWAY',
  'MOYASAR_SECRET_KEY',
  'MOYASAR_PUBLISHABLE_KEY',
  'MOYASAR_WEBHOOK_SECRET',
  'MOYASAR_API_BASE',
  'MOYASAR_ALLOW_LIVE_IN_DEV',
  'MOYASAR_ALLOW_TEST_IN_PRODUCTION',
] as const;
