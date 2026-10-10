/*
 * The log in and sign-up forms call `fetch` and move on with the client router, so no form post or
 * page load tells the browser that the password it just saw typed was good. Chromium has an API for
 * exactly this: hand it the credential after the server accepted it and it offers to save (or
 * update) it. Other browsers watch the form disappear from the page instead. Everything here is
 * best effort: a browser without the API, a locked or refusing password manager or an insecure
 * context must never turn a login that worked into an error, and nothing is logged.
 *
 * The password is never kept: it is an argument of one call, put into a credential object the
 * browser owns. It touches no storage of ours (no localStorage, sessionStorage or cookie).
 */

/** `PasswordCredential` is not in the DOM typings (it is a Chromium feature). */
interface PasswordCredentialInit {
  id: string;
  password: string;
  name?: string;
}
type PasswordCredentialConstructor = new (init: PasswordCredentialInit) => Credential;

function passwordCredentialClass(): PasswordCredentialConstructor | undefined {
  const candidate = (window as unknown as { PasswordCredential?: unknown }).PasswordCredential;
  return typeof candidate === 'function' ? (candidate as PasswordCredentialConstructor) : undefined;
}

/** `navigator.credentials` exists in secure contexts only (https, or localhost). */
function credentialsContainer(): CredentialsContainer | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.credentials;
}

/**
 * Offers the browser's password manager the email and password that just signed somebody in or
 * up, so it can ask "Save password?" (`name` is shown beside the address in its account list).
 * Call only after the server accepted them.
 */
export function offerToSaveLogin({ id, password, name }: PasswordCredentialInit): void {
  try {
    const PasswordCredential = passwordCredentialClass();
    const credentials = credentialsContainer();
    if (!PasswordCredential || typeof credentials?.store !== 'function') return;
    const credential = new PasswordCredential(name ? { id, password, name } : { id, password });
    // `Promise.resolve`: whatever `store` returns, a refusal ends here.
    void Promise.resolve(credentials.store(credential)).catch(() => undefined);
  } catch {
    // Not available, or the browser refused: signing in does not depend on it.
  }
}

/**
 * After a log out: tells the browser not to sign this person straight back in with a saved
 * credential the next time a page asks for one (the account chooser will wait for a click). Nothing
 * here signs anybody in on page load, but the flag is the browser's own memory of "signed out".
 */
export function stopSilentSignIn(): void {
  try {
    const credentials = credentialsContainer();
    if (typeof credentials?.preventSilentAccess !== 'function') return;
    void Promise.resolve(credentials.preventSilentAccess()).catch(() => undefined);
  } catch {
    // Not available: the session cookie is already gone, which is what matters.
  }
}
