'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, isApiError } from '@/lib/api-client';
import type { UserDTO } from '@/lib/api-types';

/**
 * The signed-in user as the UI needs it (the server's `SessionUser`, or `GET /auth/me` minus
 * dates). The three confirmation fields are optional so a hand-built user stays valid: absent
 * means "no confirmation needed", which is what a server without email confirmation reports.
 * `hasPassword` is optional the same way: absent means the account has a password.
 */
export type CurrentUser = Pick<
  UserDTO,
  'id' | 'email' | 'name' | 'role' | 'locale' | 'creditBalance'
> &
  Partial<
    Pick<
      UserDTO,
      'emailVerified' | 'emailVerificationRequired' | 'pendingBonusCredits' | 'hasPassword'
    >
  >;

/**
 * The server requires a confirmed address and this account has none: it cannot generate or buy
 * until the emailed link is opened (confirming pays no credits). Studio and Pricing say so instead
 * of "not enough credits" / "buy".
 */
export function needsEmailConfirmation(user: CurrentUser | null): boolean {
  return user !== null && user.emailVerificationRequired === true && user.emailVerified !== true;
}

export interface UserContextValue {
  /** Null for visitors (and after the session expired). */
  user: CurrentUser | null;
  /** The live balance; 0 for visitors. Updated by `setCreditBalance` and `refresh`. */
  creditBalance: number;
  /** The account has to confirm its email address before it may generate or buy (see {@link needsEmailConfirmation}). */
  emailConfirmationNeeded: boolean;
  /**
   * Re-reads the user from `GET /api/v1/auth/me`. Call it after anything that spends or grants
   * credits (a generation finished, a purchase). Never rejects: a network failure keeps the
   * current values, a 401 signs the user out of the UI.
   */
  refresh: () => Promise<void>;
  /** Applies a balance already known from an API response, without another request. */
  setCreditBalance: (balance: number) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

/** Re-read on tab focus at most this often, so a balance changed elsewhere does not stay stale. */
const FOCUS_REFRESH_MS = 60_000;
/**
 * An account waiting for its confirmation link re-reads sooner: the link is opened in another tab
 * or on a phone, and the person comes back expecting the page to have noticed.
 */
const CONFIRMATION_FOCUS_REFRESH_MS = 3_000;

export interface UserProviderProps {
  /** The user resolved on the server for this request (null for visitors). */
  initialUser: CurrentUser | null;
  children: ReactNode;
}

interface State {
  user: CurrentUser | null;
  creditBalance: number;
}

const fromUser = (user: CurrentUser | null): State => ({
  user,
  creditBalance: user?.creditBalance ?? 0,
});

/**
 * Holds the current user for client components. It starts from the server-resolved
 * `initialUser`, follows later server values (after `router.refresh()`), and talks to
 * `/api/v1/auth/me` when asked to `refresh()`.
 */
export function UserProvider({ initialUser, children }: UserProviderProps) {
  const [state, setState] = useState<State>(() => fromUser(initialUser));
  const [seed, setSeed] = useState(initialUser);
  // A new server render (router.refresh) hands in a fresh object: adopt it when it differs.
  if (seed !== initialUser) {
    setSeed(initialUser);
    if (!sameUser(seed, initialUser)) setState(fromUser(initialUser));
  }

  const inFlight = useRef<Promise<void> | null>(null);
  const lastRefresh = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const request = (async () => {
      try {
        const fresh = await api.get<UserDTO | null>('/auth/me');
        setState(fromUser(fresh));
      } catch (error) {
        if (isApiError(error) && error.status === 401) setState(fromUser(null));
        // Any other failure keeps what we have; the next refresh tries again.
      } finally {
        lastRefresh.current = Date.now();
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, []);

  const setCreditBalance = useCallback((balance: number) => {
    setState((current) => (current.user ? { ...current, creditBalance: balance } : current));
  }, []);

  const signedIn = state.user !== null;
  const confirming = needsEmailConfirmation(state.user);
  useEffect(() => {
    if (!signedIn) return;
    lastRefresh.current = Date.now();
    const gap = confirming ? CONFIRMATION_FOCUS_REFRESH_MS : FOCUS_REFRESH_MS;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > gap) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    // Switching to another WINDOW (the mail client, a phone's browser app) only moves focus: the
    // tab stays visible, so `visibilitychange` never fires. Only an account that is waiting for
    // something to change elsewhere listens for it.
    if (confirming) window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signedIn, confirming, refresh]);

  const value = useMemo<UserContextValue>(
    () => ({ ...state, emailConfirmationNeeded: confirming, refresh, setCreditBalance }),
    [state, confirming, refresh, setCreditBalance],
  );
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

function sameUser(a: CurrentUser | null, b: CurrentUser | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.name === b.name &&
    a.role === b.role &&
    a.locale === b.locale &&
    a.creditBalance === b.creditBalance &&
    a.emailVerified === b.emailVerified &&
    a.emailVerificationRequired === b.emailVerificationRequired &&
    a.pendingBonusCredits === b.pendingBonusCredits &&
    a.hasPassword === b.hasPassword
  );
}

export function useUser(): UserContextValue {
  const value = useContext(UserContext);
  if (!value) throw new Error('useUser must be used inside <UserProvider>');
  return value;
}

/**
 * Like {@link useUser}, but null outside a provider: for a component that can follow the account
 * when there is one and still has to work (and be tested) without it.
 */
export function useOptionalUser(): UserContextValue | null {
  return useContext(UserContext);
}
