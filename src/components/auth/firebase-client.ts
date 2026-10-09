import type { FirebaseWebConfig } from '@/lib/firebase-config';

/**
 * The browser half of Google sign-in. The Firebase SDK is only a way to get a Google-signed ID
 * token: it is loaded on demand (a separate chunk, never part of the first page load), keeps
 * nothing in the browser (in-memory persistence) and signs out again as soon as the token has been
 * handed to this app, whose own session cookie is what keeps the person signed in.
 */

/**
 * The pages that are served with the headers Firebase's popup needs (a CSP that lets it load its
 * helper frame and a Cross-Origin-Opener-Policy that keeps `window.opener`). It must match
 * `AUTH_PAGE_PATHS` in `server/security/headers.ts`; a test holds the two together.
 */
export const AUTH_PAGE_PATHS: readonly string[] = ['/login', '/register'];

/**
 * True when the document the browser actually loaded is not one of the auth pages. Navigating here
 * from another page inside the app (a link in the header) is a client-side transition: the page
 * keeps the strict headers of the document it came from, and the popup cannot work under them.
 * Reloading once fetches this page with its own headers. It cannot loop: after the reload the
 * loaded document is the auth page itself.
 */
export function loadedOutsideAuthPages(): boolean {
  if (typeof performance.getEntriesByType !== 'function') return false;
  const entry = performance.getEntriesByType('navigation')[0];
  if (!entry) return false;
  try {
    return !AUTH_PAGE_PATHS.includes(new URL(entry.name).pathname);
  } catch {
    return false;
  }
}

/** True on a phone or tablet: no pointer ever hovers there, so the button can only be warmed up early. */
export function isTouchDevice(): boolean {
  if (navigator.maxTouchPoints > 0) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Runs `callback` when the browser has nothing better to do (soon after load at the latest) and
 * returns the function that cancels it. Safari has no `requestIdleCallback`, hence the timer.
 */
export function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 1500);
  return () => window.clearTimeout(id);
}

/** One named Firebase app for this feature, so the page's own Firebase use (if any) is untouched. */
export const FIREBASE_APP_NAME = 'aivore-google-signin';

const loadApp = () => import('@firebase/app');
const loadAuth = () => import('@firebase/auth');
interface Sdk {
  app: Awaited<ReturnType<typeof loadApp>>;
  auth: Awaited<ReturnType<typeof loadAuth>>;
}

let loading: Promise<Sdk> | undefined;

/**
 * Starts loading the SDK chunks (once). Safe to call early, for instance when the pointer reaches
 * the button. Loading the code is only half of being ready for a click: see
 * {@link createFirebaseClient}.
 */
export function preloadFirebase(): Promise<Sdk> {
  loading ??= Promise.all([loadApp(), loadAuth()]).then(([app, auth]) => ({ app, auth }));
  // A failed download must not be remembered: the next click tries again.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

export interface FirebaseClient {
  /** Opens the Google popup (account chooser every time) and returns the ID token it produced. */
  signInWithGoogle(): Promise<string>;
  /** Forgets the Firebase user. Never throws. */
  signOut(): Promise<void>;
}

function appFor(sdk: Sdk, config: FirebaseWebConfig) {
  // Guarded: a second click, a second mounted button or a hot reload must not initialize twice.
  return (
    sdk.app.getApps().find((app) => app.name === FIREBASE_APP_NAME) ??
    sdk.app.initializeApp(config, FIREBASE_APP_NAME)
  );
}

function authFor(sdk: Sdk, config: FirebaseWebConfig) {
  const app = appFor(sdk, config);
  try {
    return sdk.auth.initializeAuth(app, {
      persistence: sdk.auth.inMemoryPersistence,
      popupRedirectResolver: sdk.auth.browserPopupRedirectResolver,
    });
  } catch {
    // Already initialized for this app (`auth/already-initialized`): use that instance.
    return sdk.auth.getAuth(app);
  }
}

/**
 * Loads the SDK and initializes Firebase Auth (`initializeAuth`, which opens no popup). Call it
 * BEFORE the click, as soon as the person shows interest in the button: Safari and mobile browsers
 * only let a popup open right after a tap, and the SDK sets up its helper iframe and Google's
 * script at this step ("proactive initialization"). Created inside the click handler, the popup
 * would wait for those downloads and be blocked on a slow connection. Safe to call again: the
 * Firebase app and its Auth instance are reused.
 */
export async function createFirebaseClient(config: FirebaseWebConfig): Promise<FirebaseClient> {
  const sdk = await preloadFirebase();
  const auth = authFor(sdk, config);
  return {
    async signInWithGoogle() {
      const provider = new sdk.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await sdk.auth.signInWithPopup(auth, provider);
      return credential.user.getIdToken();
    },
    async signOut() {
      try {
        await sdk.auth.signOut(auth);
      } catch {
        // Nothing to clean up that matters: the token is already spent or never existed.
      }
    },
  };
}
