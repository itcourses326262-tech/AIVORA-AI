import {
  FORGOT_RATE_LIMIT,
  RESET_RATE_LIMIT,
  VERIFY_CONFIRM_RATE_LIMIT,
  VERIFY_REQUEST_RATE_LIMIT,
} from '@/app/api/v1/auth/email-rate-limits';
import {
  LOGIN_RATE_LIMIT,
  LOGOUT_ALL_RATE_LIMIT,
  LOGOUT_RATE_LIMIT,
  ME_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
} from '@/app/api/v1/auth/rate-limits';
import { ref } from '../components';
import { userExample } from '../examples';
import {
  data,
  empty,
  failure,
  rateLimit,
  rateLimited,
  unauthorized,
  validationFailed,
  type EndpointSpec,
} from '../operation';

export const AUTH_TAG = 'Sessions and sign-in';

const originNote =
  'Browsers send the `Origin` header on their own; any other client must send `Origin` equal to the site origin, or the request is a 403.';

const linkProblem = (what: string) =>
  failure('bad_request', `${what} \`details.reason\` is \`invalid\`, \`expired\` or \`used\`.`, {
    details: { reason: 'expired' },
  });

export const authEndpoints: EndpointSpec[] = [
  {
    operationId: 'register',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/register',
    summary: 'Create an account',
    description: [
      'Creates an account, signs the browser in (`aivore_session` cookie) and grants the signup bonus in the same step. Where email confirmation is required the bonus follows the confirmation.',
      originNote,
    ].join('\n\n'),
    access: 'public',
    limits: [rateLimit(REGISTER_RATE_LIMIT, 'public')],
    curl: { cookies: 'save', origin: true },
    request: {
      description: 'The new account.',
      schema: ref('RegisterRequest'),
      example: {
        email: 'layla@example.com',
        password: 'correct horse battery staple',
        name: 'Layla',
        locale: 'ar',
      },
    },
    responses: [
      data(201, 'The account, signed in.', ref('User'), userExample, ['Set-Cookie']),
      failure(
        'signup_disabled',
        'Registration is closed (`signup_disabled`), or the request has no matching `Origin` (`forbidden`).',
      ),
      failure(
        'conflict',
        'This account could not be created with these details. The text is the same whatever the reason, so addresses cannot be probed.',
      ),
      validationFailed(
        'A field is not valid (`validation_failed`, for example a password on the deny list), or the address is a throwaway domain (`email_not_allowed`).',
        [{ path: 'password', message: 'This password is too common' }],
      ),
      failure(
        'rate_limited',
        'Too many sign-ups (`rate_limited`) or too many accounts from this network today (`signup_limit`).',
        { details: { retryAfterSec: 1800 }, headers: ['Retry-After'] },
      ),
    ],
  },
  {
    operationId: 'login',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/login',
    summary: 'Sign in',
    description: [
      'Signs the browser in with a new session cookie. Every failure is the same 401 with the same text, whether the address is unknown, the password is wrong or the address is malformed.',
      originNote,
    ].join('\n\n'),
    access: 'public',
    limits: [rateLimit(LOGIN_RATE_LIMIT, 'public')],
    curl: { cookies: 'save', origin: true },
    request: {
      description: 'The credentials.',
      schema: ref('LoginRequest'),
      example: { email: 'layla@example.com', password: 'correct horse battery staple' },
    },
    responses: [
      data(200, 'The account, signed in.', ref('User'), userExample, ['Set-Cookie']),
      failure('unauthorized', 'Invalid email or password.'),
      failure(
        'forbidden',
        'The account is disabled (only after the right password), or the request has no matching `Origin`.',
      ),
      rateLimited(),
    ],
  },
  {
    operationId: 'logout',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/logout',
    summary: 'Sign out',
    description: [
      'Ends this browser session and clears the cookie. Harmless without a session.',
      originNote,
    ].join('\n\n'),
    access: 'public',
    limits: [rateLimit(LOGOUT_RATE_LIMIT, 'public')],
    curl: { cookies: 'send', origin: true },
    responses: [
      { ...empty(204, 'Signed out. The cookie is cleared.'), headers: ['Set-Cookie'] },
      failure('forbidden', 'The request has no matching `Origin`.'),
      rateLimited(),
    ],
  },
  {
    operationId: 'logoutAll',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/logout-all',
    summary: 'Sign out everywhere',
    description:
      'Ends every browser session of the account, this one included. API keys keep working.',
    access: 'session',
    limits: [rateLimit(LOGOUT_ALL_RATE_LIMIT, 'session')],
    responses: [
      { ...empty(204, 'Signed out everywhere. The cookie is cleared.'), headers: ['Set-Cookie'] },
      unauthorized(),
      failure('forbidden', 'An API key was used, or the request has no matching `Origin`.'),
      rateLimited(),
    ],
  },
  {
    operationId: 'getMe',
    tag: AUTH_TAG,
    method: 'get',
    path: '/auth/me',
    summary: 'Who am I',
    description:
      'The signed-in account, or `null` for a visitor. Never a 401, so a page can ask on every load.',
    access: 'optional',
    limits: [rateLimit(ME_RATE_LIMIT, 'optional')],
    curl: { auth: true },
    responses: [
      data(
        200,
        'The account, or `null` when no valid credentials were sent.',
        { anyOf: [ref('User'), { type: 'null' }] },
        userExample,
      ),
      rateLimited(),
    ],
  },
  {
    operationId: 'requestPasswordReset',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/password/forgot',
    summary: 'Email a password reset link',
    description: [
      'Asks for a reset link. The answer is the same whether or not the address has an account, and the work happens after the response, so neither the text nor the timing reveals anything. The link works once, for one hour.',
      originNote,
    ].join('\n\n'),
    access: 'public',
    limits: [rateLimit(FORGOT_RATE_LIMIT, 'public')],
    curl: { origin: true },
    request: {
      description: 'The address of the account.',
      schema: ref('ForgotPasswordRequest'),
      example: { email: 'layla@example.com' },
    },
    responses: [
      data(202, 'Accepted.', ref('Accepted'), { accepted: true }),
      failure('forbidden', 'The request has no matching `Origin`.'),
      validationFailed('The address is not valid.', [
        { path: 'email', message: 'Enter a valid email address' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'resetPassword',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/password/reset',
    summary: 'Set a new password from an emailed link',
    description: [
      'Sets the password with the secret from the emailed link. Every session of the account is signed out (this call opens none: sign in with the new password), other reset links stop working and a notice is mailed. A password the policy refuses is a 422 and does not use up the link.',
      originNote,
    ].join('\n\n'),
    access: 'public',
    limits: [rateLimit(RESET_RATE_LIMIT, 'public')],
    curl: { origin: true },
    request: {
      description: 'The link secret and the new password.',
      schema: ref('ResetPasswordRequest'),
      example: {
        token: 'k3JH9sQ0v5e1fLw8XnT2mZpR7uYbCaD4gIoE6hNqVxM',
        password: 'a-much-longer-passphrase-2026',
      },
    },
    responses: [
      empty(204, 'The password was changed.'),
      linkProblem('The link cannot be used.'),
      failure('forbidden', 'The request has no matching `Origin`.'),
      validationFailed('The password breaks the policy.', [
        { path: 'password', message: 'This password is too common' },
      ]),
      rateLimited(),
    ],
  },
  {
    operationId: 'requestEmailVerification',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/verify-email/request',
    summary: 'Send a new confirmation link',
    description:
      'Emails a fresh confirmation link to the signed-in account. A second request within 60 seconds is a 429 whose `details.retryAfterSec` says how long to wait.',
    access: 'any',
    limits: [rateLimit(VERIFY_REQUEST_RATE_LIMIT, 'any')],
    responses: [
      data(202, 'A link is on its way.', ref('VerifyEmailRequestResult'), {
        sent: true,
        verified: false,
        resendAfterSec: 60,
      }),
      data(
        200,
        'The address is already confirmed; nothing was sent.',
        ref('VerifyEmailRequestResult'),
        {
          sent: false,
          verified: true,
          resendAfterSec: 0,
        },
      ),
      unauthorized(),
      rateLimited(),
    ],
  },
  {
    operationId: 'confirmEmail',
    tag: AUTH_TAG,
    method: 'post',
    path: '/auth/verify-email/confirm',
    summary: 'Confirm an email address',
    description:
      'Confirms the address with the secret from the emailed link and releases the signup bonus if it was waiting. Opening the link in a browser changes nothing by itself; the page it opens calls this endpoint, so mail scanners cannot use the link up. No session is needed: the link may be opened on another device.',
    access: 'public',
    limits: [rateLimit(VERIFY_CONFIRM_RATE_LIMIT, 'public')],
    request: {
      description: 'The link secret.',
      schema: ref('ConfirmEmailRequest'),
      example: { token: 'k3JH9sQ0v5e1fLw8XnT2mZpR7uYbCaD4gIoE6hNqVxM' },
    },
    responses: [
      data(200, 'Confirmed.', ref('VerifyEmailConfirmResult'), {
        verified: true,
        alreadyVerified: false,
        bonusCredits: 50,
      }),
      linkProblem('The link cannot be used.'),
      rateLimited(),
    ],
  },
];
