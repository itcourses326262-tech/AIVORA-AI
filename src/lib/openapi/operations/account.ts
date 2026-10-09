import {
  ACCOUNT_DELETE_RATE_LIMIT,
  ACCOUNT_EXPORT_RATE_LIMIT,
} from '@/app/api/v1/account/data-rate-limits';
import {
  ACCOUNT_READ_RATE_LIMIT,
  ACCOUNT_WRITE_RATE_LIMIT,
  PASSWORD_RATE_LIMIT,
} from '@/app/api/v1/account/rate-limits';
import { KEYS_READ_RATE_LIMIT, KEYS_WRITE_RATE_LIMIT } from '@/app/api/v1/keys/rate-limits';
import { MAX_ACTIVE_API_KEYS } from '@/server/auth/api-keys';
import { ref } from '../components';
import { apiKeyExample, createdApiKeyExample, IDS, ledgerExample, userExample } from '../examples';
import {
  data,
  empty,
  failure,
  pageOf,
  rateLimit,
  rateLimited,
  unauthorized,
  validationFailed,
  type EndpointSpec,
} from '../operation';
import { defaultLimitParam, cursorParam, idPathParam, JSON_BODY_BYTES } from './common';

export const ACCOUNT_TAG = 'Account';
export const KEYS_TAG = 'API keys';

const browserOnly = (what: string) =>
  failure(
    'forbidden',
    `${what} needs a browser session: an API key is refused. A cookie-authenticated request without a matching \`Origin\` header is also a 403.`,
  );

export const accountEndpoints: EndpointSpec[] = [
  {
    operationId: 'getAccount',
    tag: ACCOUNT_TAG,
    method: 'get',
    path: '/account',
    summary: 'Get your account',
    description: 'Your profile and the credit balance right now.',
    access: 'any',
    limits: [rateLimit(ACCOUNT_READ_RATE_LIMIT, 'any')],
    responses: [data(200, 'The account.', ref('User'), userExample), unauthorized(), rateLimited()],
  },
  {
    operationId: 'updateAccount',
    tag: ACCOUNT_TAG,
    method: 'patch',
    path: '/account',
    summary: 'Update your profile',
    description:
      'Changes the display name and/or the preferred language. A language change also sets the `aivore_locale` cookie, so the next page of the web app is already in that language.',
    access: 'any',
    limits: [rateLimit(ACCOUNT_WRITE_RATE_LIMIT, 'any')],
    request: {
      description: 'The fields to change.',
      maxBytes: JSON_BODY_BYTES.account,
      schema: ref('UpdateAccountRequest'),
      example: { name: 'Layla', locale: 'ar' },
    },
    responses: [
      data(200, 'The updated account.', ref('User'), userExample, ['Set-Cookie']),
      unauthorized(),
      validationFailed(
        'The name is empty, too long or has unprintable characters; or nothing was sent.',
        [{ path: 'name', message: 'Must be 1 to 80 printable characters' }],
      ),
      rateLimited(),
    ],
  },
  {
    operationId: 'deleteAccount',
    tag: ACCOUNT_TAG,
    method: 'delete',
    path: '/account',
    summary: 'Delete your account',
    description: [
      'Permanently erases the account: sessions and API keys end at once, every generation and stored file is removed, and the profile is anonymised. The credit and payment records stay for accounting, without anything that names you. A confirmation email is sent.',
      'The current password must be sent to confirm. There is no undo.',
    ].join('\n\n'),
    access: 'session',
    limits: [rateLimit(ACCOUNT_DELETE_RATE_LIMIT, 'session')],
    request: {
      description: 'The current password.',
      maxBytes: JSON_BODY_BYTES.account,
      schema: ref('DeleteAccountRequest'),
      example: { password: 'correct horse battery staple' },
    },
    responses: [
      empty(204, 'Deleted. The session cookie is cleared.'),
      unauthorized(),
      browserOnly('Deleting the account'),
      validationFailed('The password is wrong.', [
        { path: 'password', message: 'Password is incorrect' },
      ]),
      rateLimited(),
      failure(
        'provider_error',
        'A subscription could not be canceled with the payment provider, so nothing was deleted. Try again.',
      ),
    ],
  },
  {
    operationId: 'changePassword',
    tag: ACCOUNT_TAG,
    method: 'post',
    path: '/account/password',
    summary: 'Change your password',
    description:
      'Sets a new password. Every other browser session of the account is signed out; this one stays. API keys are not affected.',
    access: 'session',
    limits: [rateLimit(PASSWORD_RATE_LIMIT, 'session')],
    request: {
      description: 'The current and the new password.',
      maxBytes: JSON_BODY_BYTES.account,
      schema: ref('ChangePasswordRequest'),
      example: {
        currentPassword: 'correct horse battery staple',
        newPassword: 'a-much-longer-passphrase-2026',
      },
    },
    responses: [
      empty(204, 'Changed.'),
      unauthorized(),
      browserOnly('Changing the password'),
      validationFailed(
        'The current password is wrong (`currentPassword`), the new one breaks the policy (`password`) or equals the current one (`newPassword`).',
        [{ path: 'currentPassword', message: 'Current password is incorrect' }],
      ),
      rateLimited(),
    ],
  },
  {
    operationId: 'listLedger',
    tag: ACCOUNT_TAG,
    method: 'get',
    path: '/account/ledger',
    summary: 'Credit history',
    description:
      'Every change of your credit balance, newest first: the signup bonus, what each generation cost, refunds and purchases. `balanceAfter` chains the entries together.',
    access: 'any',
    limits: [rateLimit(ACCOUNT_READ_RATE_LIMIT, 'any')],
    curl: { query: { limit: 20 } },
    params: [defaultLimitParam, cursorParam],
    responses: [
      pageOf('A page of ledger entries.', ref('LedgerEntry'), ledgerExample),
      unauthorized(),
      validationFailed('A parameter is not valid.', [
        { path: 'limit', message: 'Number must be less than or equal to 100' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'exportAccount',
    tag: ACCOUNT_TAG,
    method: 'get',
    path: '/account/export',
    summary: 'Download your data',
    description:
      'Everything the platform holds about you as one JSON file: profile, sessions, API key metadata (never secrets), credit history, purchases (orders and plans, without payment pages or gateway ids), generations and the URLs of their files. Streams as an attachment. Three downloads a day.',
    access: 'session',
    limits: [rateLimit(ACCOUNT_EXPORT_RATE_LIMIT, 'session')],
    responses: [
      {
        status: 200,
        description: 'The export, with `Content-Disposition: attachment`.',
        body: { kind: 'raw', contentTypes: ['application/json'], schema: { type: 'object' } },
      },
      unauthorized(),
      browserOnly('Exporting your data'),
      rateLimited(),
    ],
  },
];

const keyIdParam = idPathParam(
  'id',
  'key',
  'The key id (`ApiKey.id`), not the key itself.',
  IDS.key,
);

export const keyEndpoints: EndpointSpec[] = [
  {
    operationId: 'listApiKeys',
    tag: KEYS_TAG,
    method: 'get',
    path: '/keys',
    summary: 'List your API keys',
    description:
      'Every active key plus the most recently revoked ones, newest first. Only the prefix is shown, never the secret. `nextCursor` is always `null`.',
    access: 'session',
    limits: [rateLimit(KEYS_READ_RATE_LIMIT, 'session')],
    responses: [
      pageOf('The keys.', ref('ApiKey'), [apiKeyExample]),
      unauthorized(),
      browserOnly('Managing API keys'),
      rateLimited(),
    ],
  },
  {
    operationId: 'createApiKey',
    tag: KEYS_TAG,
    method: 'post',
    path: '/keys',
    summary: 'Create an API key',
    description: `Creates a key. The response carries the full secret in \`key\`, and this is the only time it is ever shown: store it now. You can have ${MAX_ACTIVE_API_KEYS} active keys at most.`,
    access: 'session',
    limits: [rateLimit(KEYS_WRITE_RATE_LIMIT, 'session')],
    request: {
      description: 'A label for the key.',
      maxBytes: JSON_BODY_BYTES.account,
      schema: ref('CreateApiKeyRequest'),
      example: { name: 'Production server' },
    },
    responses: [
      data(201, 'The new key.', ref('CreatedApiKey'), createdApiKeyExample),
      unauthorized(),
      failure(
        'forbidden',
        'Creating API keys needs a browser session: an API key is refused (`forbidden`), and so is a cookie-authenticated request without a matching `Origin` header. Where email confirmation is required, an account that has not confirmed its address yet is refused too (`email_not_verified`): confirm it first.',
      ),
      failure('conflict', `You already have ${MAX_ACTIVE_API_KEYS} active keys. Revoke one first.`),
      validationFailed('The name is empty or too long.', [
        { path: 'name', message: 'Must be 1 to 60 printable characters' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'revokeApiKey',
    tag: KEYS_TAG,
    method: 'delete',
    path: '/keys/{id}',
    summary: 'Revoke an API key',
    description:
      'Stops the key working at once. Revoking a key twice is harmless. The key stays in the list as revoked.',
    access: 'session',
    limits: [rateLimit(KEYS_WRITE_RATE_LIMIT, 'session')],
    params: [keyIdParam],
    responses: [
      empty(204, 'Revoked.'),
      unauthorized(),
      browserOnly('Revoking API keys'),
      failure('not_found', 'No key of yours has this id.'),
      rateLimited(),
    ],
  },
];
