import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserProvider, useUser, type CurrentUser } from '@/lib/user-context';

const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance: 50,
};

function Probe() {
  const { user, creditBalance, refresh, setCreditBalance } = useUser();
  return (
    <div>
      <p data-testid="name">{user ? user.name : 'guest'}</p>
      <p data-testid="credits">{creditBalance}</p>
      <button onClick={() => void refresh()}>refresh</button>
      <button onClick={() => setCreditBalance(7)}>set</button>
    </div>
  );
}

function stubFetch(handler: () => Promise<Response> | Response) {
  const fetchMock = vi.fn(async () => handler());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UserProvider / useUser', () => {
  it('starts from the server-resolved user', () => {
    render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId('name')).toHaveTextContent('Layla');
    expect(screen.getByTestId('credits')).toHaveTextContent('50');
  });

  it('is a guest with no credits when the server found no user', async () => {
    const user = userEvent.setup();
    render(
      <UserProvider initialUser={null}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId('name')).toHaveTextContent('guest');
    expect(screen.getByTestId('credits')).toHaveTextContent('0');
    await user.click(screen.getByRole('button', { name: 'set' }));
    expect(screen.getByTestId('credits')).toHaveTextContent('0');
  });

  it('refresh() reads GET /api/v1/auth/me and updates the user and the balance', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(() =>
      json({ data: { ...LAYLA, name: 'Layla H.', creditBalance: 12 } }),
    );
    render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('credits')).toHaveTextContent('12'));
    expect(screen.getByTestId('name')).toHaveTextContent('Layla H.');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/me');
    expect(init.method).toBe('GET');
  });

  it('a 401 from refresh signs the user out of the UI', async () => {
    const user = userEvent.setup();
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'no' } }, 401));
    render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('guest'));
  });

  it('{ data: null } from the API means the session ended', async () => {
    const user = userEvent.setup();
    stubFetch(() => json({ data: null }));
    render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('guest'));
  });

  it('a network failure keeps the current values and never rejects', async () => {
    stubFetch(() => {
      throw new TypeError('offline');
    });
    let result: Promise<void> | undefined;
    function Capture() {
      const { refresh } = useUser();
      return <button onClick={() => (result = refresh())}>go</button>;
    }
    render(
      <UserProvider initialUser={LAYLA}>
        <Capture />
        <Probe />
      </UserProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'go' }));
    await expect(result).resolves.toBeUndefined();
    expect(screen.getByTestId('name')).toHaveTextContent('Layla');
    expect(screen.getByTestId('credits')).toHaveTextContent('50');
  });

  it('concurrent refreshes share one request', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    function Double() {
      const { refresh } = useUser();
      return (
        <button
          onClick={() => {
            void refresh();
            void refresh();
          }}
        >
          twice
        </button>
      );
    }
    render(
      <UserProvider initialUser={LAYLA}>
        <Double />
      </UserProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'twice' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(json({ data: LAYLA }));
    });
  });

  it('setCreditBalance applies a balance already known from an API response', async () => {
    const user = userEvent.setup();
    render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'set' }));
    expect(screen.getByTestId('credits')).toHaveTextContent('7');
  });

  it('adopts a new server value after router.refresh() but ignores an identical one', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'set' }));
    // A fresh object with the same data (a re-render of the layout) must not undo the local balance.
    rerender(
      <UserProvider initialUser={{ ...LAYLA }}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId('credits')).toHaveTextContent('7');
    rerender(
      <UserProvider initialUser={{ ...LAYLA, creditBalance: 99 }}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId('credits')).toHaveTextContent('99');
    rerender(
      <UserProvider initialUser={null}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId('name')).toHaveTextContent('guest');
  });

  it('refreshes when the tab becomes visible again after a minute, not before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFetch(() => json({ data: LAYLA }));
    render(
      <UserProvider initialUser={LAYLA}>
        <Probe />
      </UserProvider>,
    );
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(61_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not poll for a guest', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFetch(() => json({ data: null }));
    render(
      <UserProvider initialUser={null}>
        <Probe />
      </UserProvider>,
    );
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('useUser outside a provider is a programming error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useUser must be used inside <UserProvider>');
  });
});
