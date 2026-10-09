import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeysPanel } from '@/components/account/keys-panel';
import type { ApiKeyDTO, CreateApiKeyResponse } from '@/lib/api-types';
import { buildOpenApiDocument } from '@/lib/openapi/spec';
import { axeViolations } from '../axe';
import {
  apiError,
  installFakeApi,
  json,
  LAYLA,
  mountAccount,
  resetAccountTest,
  router,
  type FakeApi,
} from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(resetAccountTest);

const LIMITS = { maxActive: 3, nameMax: 40 };
const ORIGIN = 'https://aivore.example';
const SECRET = 'avk_ab12cd34_0123456789abcdefghijklmnopqrstuv';
const T0 = Date.UTC(2026, 4, 1, 9, 0);

function key(index: number, overrides: Partial<ApiKeyDTO> = {}): ApiKeyDTO {
  return {
    id: `key_${index}`,
    name: `Key number ${index}`,
    prefix: `avk_pre${index}`,
    createdAt: T0 + index,
    ...overrides,
  };
}

/**
 * Whether the example calls an endpoint that looks at the key (an `optional` one such as
 * `GET /models` answers 200 to a wrong key, so it proves nothing about the key just made).
 */
function tellsAWrongKeyApart(command: string | null): boolean {
  const path = /\/api\/v1(\/[\w/-]+)/.exec(command ?? '')?.[1] ?? '';
  const operation = buildOpenApiDocument(ORIGIN).paths[path]?.get;
  if (!operation) return false;
  const anonymous =
    operation.security.length === 0 || operation.security.some((r) => !Object.keys(r).length);
  return !anonymous && operation.security.some((requirement) => 'bearerAuth' in requirement);
}

const listOf = (keys: ApiKeyDTO[]) => () => json({ data: keys, nextCursor: null });
const created = (record: ApiKeyDTO): CreateApiKeyResponse => ({ key: SECRET, record });

function mount(keys: ApiKeyDTO[] = [key(1)], locale: 'en' | 'ar' = 'en') {
  const api = installFakeApi({ 'GET /keys': listOf(keys) });
  const view = mountAccount(<KeysPanel limits={LIMITS} origin={ORIGIN} />, {
    locale,
    user: { ...LAYLA, locale },
  });
  return { api, view };
}

const createButton = () => screen.getByRole('button', { name: 'Create key' });
const list = () => screen.findByRole('list', { name: 'Your API keys' });

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await list();
  await user.click(createButton());
  return screen.findByRole('dialog', { name: 'Create an API key' });
}

async function createKey(
  user: ReturnType<typeof userEvent.setup>,
  api: FakeApi,
  name = 'CI runner',
) {
  api.on('POST /keys', () => json({ data: created(key(9, { name })) }, 201));
  const dialog = await openCreate(user);
  await user.type(within(dialog).getByRole('textbox', { name: /^Key name/ }), name);
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
  return screen.findByRole('alertdialog', { name: 'Your new API key' });
}

describe('the list', () => {
  it('shows each key with its status, its prefix and when it was last used', async () => {
    mount([
      key(1, { lastUsedAt: Date.now() - 3_600_000 }),
      key(2),
      key(3, { revokedAt: T0 + 5000 }),
    ]);
    const items = within(await list()).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Key number 1');
    expect(items[0]).toHaveTextContent('Active');
    expect(items[0]).toHaveTextContent('avk_pre1…');
    expect(items[0]).toHaveTextContent(/Last used/);
    expect(items[1]).toHaveTextContent('Never used');
    expect(items[2]).toHaveTextContent('Revoked');
    expect(items[2]).toHaveTextContent(/Revoked [A-Z]/);
    // A revoked key has nothing left to revoke; an active one names itself in the button.
    expect(within(items[2] as HTMLElement).queryByRole('button')).toBeNull();
    expect(
      within(items[1] as HTMLElement).getByRole('button', { name: 'Revoke Key number 2' }),
    ).toBeEnabled();
  });

  it('reads the prefix left to right and never shows a secret', async () => {
    mount([key(1)]);
    const prefix = (await screen.findByText('avk_pre1…')) as HTMLElement;
    expect(prefix).toHaveAttribute('dir', 'ltr');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('explains when there are no keys yet', async () => {
    mount([]);
    expect(await screen.findByText('No API keys yet')).toBeInTheDocument();
    expect(createButton()).toBeEnabled();
    expect(screen.queryByRole('list', { name: 'Your API keys' })).toBeNull();
  });

  it('shows a failure with a retry, and keeps Create off until the list is known', async () => {
    let failing = true;
    const api = installFakeApi({
      'GET /keys': () =>
        failing ? apiError(500, 'internal') : json({ data: [key(1)], nextCursor: null }),
    });
    const user = userEvent.setup();
    mountAccount(<KeysPanel limits={LIMITS} origin={ORIGIN} />);
    expect(await screen.findByText('We could not load your API keys.')).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await list();
    expect(createButton()).toBeEnabled();
    expect(api.to('GET /keys')).toHaveLength(2);
  });

  it('stops at the limit of active keys, counting only the active ones', async () => {
    mount([key(1), key(2), key(3), key(4, { revokedAt: T0 })]);
    await list();
    expect(createButton()).toBeDisabled();
    const notice = screen.getByText(/You have reached the limit of 3 active keys\./);
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('does not count revoked keys against the limit', async () => {
    mount([key(1), key(2), key(3, { revokedAt: T0 })]);
    await list();
    expect(createButton()).toBeEnabled();
    expect(screen.queryByText(/reached the limit/)).toBeNull();
  });

  it('gives a quick way to try a key, with the address of this site, and a link to the docs', async () => {
    mount([key(1)]);
    await list();
    const region = screen.getByRole('region', { name: 'Quick start · cURL' });
    expect(region).toHaveTextContent(`curl "${ORIGIN}/api/v1/account"`);
    expect(region).toHaveTextContent('Authorization: Bearer $AIVORE_API_KEY');
    expect(tellsAWrongKeyApart(region.textContent)).toBe(true);
    expect(region.textContent).not.toContain('/models');
    expect(screen.getByRole('link', { name: /Full guide and reference/ })).toHaveAttribute(
      'href',
      '/docs',
    );
  });
});

describe('creating a key', () => {
  it('asks for a name, and only for a name that fits', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    const name = within(dialog).getByRole('textbox', { name: /^Key name/ });
    expect(name).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(await within(dialog).findByText('Give the key a name.')).toBeInTheDocument();
    await user.type(name, 'x'.repeat(LIMITS.nameMax + 1));
    expect(within(dialog).queryByText('Give the key a name.')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(
      await within(dialog).findByText(`Use ${LIMITS.nameMax} characters or fewer.`),
    ).toBeInTheDocument();
    expect(api.to('POST /keys')).toHaveLength(0);
  });

  it('sends the trimmed name, then shows the key once and puts the new record first', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api, '  CI runner  ');
    expect(api.to('POST /keys')[0]?.body).toEqual({ name: 'CI runner' });
    expect(within(reveal).getByRole('textbox', { name: 'API key' })).toHaveValue(SECRET);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create an API key' })).toBeNull(),
    );
    const items = within(screen.getByRole('list', { name: 'Your API keys' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('CI runner');
    // The list holds the record, which has no secret.
    expect(items[0]).not.toHaveTextContent(SECRET);
  });

  it('shows a command that works, with the key in it, ready to copy', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    const command = within(reveal).getByRole('region', { name: 'Your new API key · cURL' });
    expect(command).toHaveTextContent(`curl "${ORIGIN}/api/v1/account"`);
    expect(command).toHaveTextContent(`Authorization: Bearer ${SECRET}`);
    expect(tellsAWrongKeyApart(command.textContent)).toBe(true);
    expect(command.textContent).not.toContain('/models');
  });

  it('shows the limit where the problem is when the server says there are too many keys', async () => {
    const { api } = mount([key(1)]);
    api.on('POST /keys', () => apiError(409, 'conflict'));
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: /^Key name/ }), 'Another');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(
      await within(dialog).findByText('You already have 3 active keys. Revoke one first.'),
    ).toBeInTheDocument();
    // What was typed is still there.
    expect(within(dialog).getByRole('textbox', { name: /^Key name/ })).toHaveValue('Another');
  });

  it.each([
    [
      'en',
      'Create key',
      'Create key',
      /^Key name/,
      /Confirm your email address before creating API keys/,
    ],
    [
      'ar',
      'إنشاء مفتاح',
      'إنشاء المفتاح',
      /^اسم المفتاح/,
      /أكّد بريدك الإلكتروني قبل إنشاء مفاتيح API/,
    ],
  ] as const)(
    'explains in terms of keys, not generations, that the email must be confirmed first (%s)',
    async (locale, openName, submitName, nameField, expected) => {
      const { api } = mount([key(1)], locale);
      api.on('POST /keys', () => apiError(403, 'email_not_verified'));
      const user = userEvent.setup();
      await screen.findByRole('list');
      await user.click(screen.getByRole('button', { name: openName }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByRole('textbox', { name: nameField }), 'CI');
      await user.click(within(dialog).getByRole('button', { name: submitName }));
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(expected);
      // Not the generic sentence about generations, and the dialog stays for another try.
      expect(alert).not.toHaveTextContent(/generations|عمليات التوليد|المحتوى/);
      expect(within(dialog).getByRole('textbox', { name: nameField })).toHaveValue('CI');
    },
  );

  it('pins a refused name to the name field', async () => {
    const { api } = mount([key(1)]);
    api.on('POST /keys', () =>
      apiError(422, 'validation_failed', { issues: [{ path: 'name', message: 'bad' }] }),
    );
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: /^Key name/ }), 'Odd');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(
      await within(dialog).findByText('Use only printable characters in the name.'),
    ).toBeInTheDocument();
  });

  it('shows any other failure in the dialog, in the words of the app', async () => {
    const { api } = mount([key(1)]);
    api.on('POST /keys', () => apiError(429, 'rate_limited', { retryAfterSec: 60 }));
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: /^Key name/ }), 'Fast');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(
      await within(dialog).findByText('Too many attempts. Try again in 60 seconds.'),
    ).toBeInTheDocument();
  });

  it('forgets the name when the dialog is cancelled', async () => {
    mount([key(1)]);
    const user = userEvent.setup();
    let dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: /^Key name/ }), 'Half done');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openCreate(user);
    expect(within(dialog).getByRole('textbox', { name: /^Key name/ })).toHaveValue('');
  });
});

describe('the one-time reveal', () => {
  it('puts the focus on Copy and warns that the key will not be shown again', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    await waitFor(() =>
      expect(within(reveal).getByRole('button', { name: 'Copy key' })).toHaveFocus(),
    );
    expect(reveal).toHaveAccessibleDescription('Store it now, it will not be shown again');
    expect(within(reveal).getByText(/the only time the full key is visible/)).toBeInTheDocument();
  });

  it('cannot be closed by accident: no close button, no Escape, no click outside', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    expect(within(reveal).queryByRole('button', { name: /^Close/ })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'Your new API key' })).toBeInTheDocument();
    // The backdrop is the dialog's parent.
    const backdrop = reveal.parentElement as HTMLElement;
    await user.click(backdrop);
    expect(screen.getByRole('alertdialog', { name: 'Your new API key' })).toBeInTheDocument();
  });

  it('copies exactly the key and confirms it in the button, a toast and for screen readers', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    await user.click(within(reveal).getByRole('button', { name: 'Copy key' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(within(reveal).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await screen.findAllByText('Key copied to the clipboard')).not.toHaveLength(0);
  });

  it('selects the whole key when the field is focused, so it can be copied by hand', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    const field = within(reveal).getByRole('textbox', { name: 'API key' }) as HTMLInputElement;
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('dir', 'ltr');
    await user.click(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(SECRET.length);
  });

  it('says so, and leaves the key selected, when the clipboard is refused', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(within(reveal).getByRole('button', { name: 'Copy key' }));
    expect(
      await screen.findAllByText('Could not copy. Select the key and copy it by hand.'),
    ).not.toHaveLength(0);
    expect(within(reveal).getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
  });

  it('is gone for good once the reader says it is stored', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    await user.click(within(reveal).getByRole('button', { name: 'I have stored it' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});

describe('revoking a key', () => {
  const ask = async (user: ReturnType<typeof userEvent.setup>, name = 'Key number 1') => {
    await list();
    await user.click(screen.getByRole('button', { name: `Revoke ${name}` }));
    return screen.findByRole('alertdialog', { name: `Revoke “${name}”?` });
  };

  it('asks first, and cancelling changes nothing', async () => {
    const { api } = mount([key(1)]);
    const user = userEvent.setup();
    const dialog = await ask(user);
    expect(dialog).toHaveAccessibleDescription(/stops working immediately/);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.to('DELETE /keys/key_1')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Revoke Key number 1' })).toBeInTheDocument();
  });

  it('revokes after confirming, and shows the key as revoked without a second request for the list', async () => {
    const { api } = mount([key(1), key(2)]);
    api.on('DELETE /keys/key_1', () => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.to('DELETE /keys/key_1')).toHaveLength(1);
    expect(await screen.findAllByText('Key revoked')).not.toHaveLength(0);
    const items = within(screen.getByRole('list', { name: 'Your API keys' })).getAllByRole(
      'listitem',
    );
    expect(items[0]).toHaveTextContent('Revoked');
    expect(within(items[0] as HTMLElement).queryByRole('button')).toBeNull();
    expect(items[1]).toHaveTextContent('Active');
    expect(api.to('GET /keys')).toHaveLength(1);
  });

  it('puts focus on the revoked key, whose button is gone, and not on the top of the page', async () => {
    const { api } = mount([key(1), key(2)]);
    api.on('DELETE /keys/key_1', () => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    await list();
    screen.getByRole('button', { name: 'Revoke Key number 1' }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke “Key number 1”?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const [revoked, active] = within(
      screen.getByRole('list', { name: 'Your API keys' }),
    ).getAllByRole('listitem');
    expect(revoked).toHaveTextContent('Revoked');
    expect(revoked).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    // The other key keeps its button, and nothing else moved.
    expect(active).not.toHaveFocus();
    expect(
      within(active as HTMLElement).getByRole('button', { name: /Revoke Key number 2/ }),
    ).toBeEnabled();
  });

  it('puts focus on the key row also when the key was already gone', async () => {
    const { api } = mount([key(1)]);
    api.on('DELETE /keys/key_1', () => apiError(404, 'not_found'));
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('listitem')).toHaveFocus();
  });

  it('leaves focus on the button it returns to when nothing was revoked', async () => {
    mount([key(1)]);
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Revoke Key number 1' })).toHaveFocus();
    expect(screen.getByRole('listitem')).not.toHaveFocus();
  });

  it('makes room under the limit', async () => {
    const { api } = mount([key(1), key(2), key(3)]);
    api.on('DELETE /keys/key_2', () => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    await list();
    expect(createButton()).toBeDisabled();
    const dialog = await ask(user, 'Key number 2');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(createButton()).toBeEnabled());
    expect(screen.queryByText(/reached the limit/)).toBeNull();
  });

  it('treats a key that is already gone as revoked', async () => {
    const { api } = mount([key(1)]);
    api.on('DELETE /keys/key_1', () => apiError(404, 'not_found'));
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('listitem')).toHaveTextContent('Revoked');
  });

  it('stays open and says what went wrong when it fails', async () => {
    const { api } = mount([key(1)]);
    api.on('DELETE /keys/key_1', () => apiError(500, 'internal'));
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/went wrong/i);
    expect(screen.getByRole('listitem')).toHaveTextContent('Active');
    expect(within(dialog).getByRole('button', { name: 'Revoke key' })).toBeEnabled();
  });

  it('cannot be dismissed while the request is on its way', async () => {
    let finish: (response: Response) => void = () => undefined;
    const { api } = mount([key(1)]);
    api.on('DELETE /keys/key_1', () => new Promise<Response>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await within(dialog).findByRole('button', { name: /Revoking/ });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    finish(new Response(null, { status: 204 }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('asks the server again when the session is gone', async () => {
    const { api } = mount([key(1)]);
    api.on('DELETE /keys/key_1', () => apiError(401, 'unauthorized'));
    const user = userEvent.setup();
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('the keys panel, as a whole', () => {
  it('has no accessibility violations, with the dialogs open too, in English', async () => {
    const { api, view } = mount([key(1, { lastUsedAt: T0 }), key(2, { revokedAt: T0 })]);
    await list();
    expect(await axeViolations(view.container)).toEqual([]);
    const user = userEvent.setup();
    const reveal = await createKey(user, api);
    expect(await axeViolations(reveal)).toEqual([]);
  });

  it('works in Arabic: text, direction of the key and of the command, accessibility', async () => {
    const { api, view } = mount([key(1)], 'ar');
    await screen.findByRole('list', { name: 'مفاتيح API الخاصة بك' });
    expect(screen.getByRole('heading', { level: 2, name: 'مفاتيح API' })).toBeInTheDocument();
    expect(await axeViolations(view.container)).toEqual([]);
    const user = userEvent.setup();
    api.on('POST /keys', () => json({ data: created(key(9, { name: 'خادم' })) }, 201));
    await user.click(screen.getByRole('button', { name: 'إنشاء مفتاح' }));
    const dialog = await screen.findByRole('dialog', { name: 'إنشاء مفتاح API' });
    await user.type(within(dialog).getByRole('textbox', { name: /^اسم المفتاح/ }), 'خادم');
    await user.click(within(dialog).getByRole('button', { name: 'إنشاء المفتاح' }));
    const reveal = await screen.findByRole('alertdialog', { name: 'مفتاح API الجديد' });
    expect(within(reveal).getByRole('textbox', { name: 'مفتاح API' })).toHaveAttribute(
      'dir',
      'ltr',
    );
    const code = within(reveal).getByRole('region', { name: /cURL/ });
    expect(code.closest('[dir]')).toHaveAttribute('dir', 'ltr');
    expect(await axeViolations(reveal)).toEqual([]);
  });
});
