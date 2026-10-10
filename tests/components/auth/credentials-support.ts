import { vi } from 'vitest';

interface PasswordCredentialInit {
  id: string;
  password: string;
  name?: string;
}

/** Stands in for the browser's `PasswordCredential` (Chromium only; jsdom has none). */
export class FakePasswordCredential {
  readonly type = 'password';
  readonly id: string;
  readonly password: string;
  readonly name: string | undefined;

  constructor(init: PasswordCredentialInit) {
    this.id = init.id;
    this.password = init.password;
    this.name = init.name;
  }
}

export interface FakeCredentials {
  store: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  preventSilentAccess: ReturnType<typeof vi.fn>;
}

/**
 * Gives this window a `navigator.credentials` made of spies (and, unless told otherwise, a
 * `PasswordCredential` class), the way Chromium has them. Undo with {@link removeCredentials}.
 */
export function installCredentials({ passwordCredential = true } = {}): FakeCredentials {
  const credentials: FakeCredentials = {
    store: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    preventSilentAccess: vi.fn(async () => undefined),
  };
  Object.defineProperty(window.navigator, 'credentials', {
    value: credentials,
    configurable: true,
  });
  if (passwordCredential) vi.stubGlobal('PasswordCredential', FakePasswordCredential);
  return credentials;
}

/** Back to a browser without the Credential Management API (Firefox, Safari, an insecure page). */
export function removeCredentials() {
  Reflect.deleteProperty(window.navigator, 'credentials');
  Reflect.deleteProperty(window, 'PasswordCredential');
}

/**
 * Watches every place a password could leak to from the page: the Web Storage areas, cookies and
 * the console. `leaks(secret)` lists what recorded the secret.
 */
export function watchForLeaks() {
  const stored: string[] = [];
  const written: string[] = [];
  const logged: string[] = [];
  const setItem = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation((key, value) => void stored.push(`${key}=${value}`));
  const cookie = vi
    .spyOn(document, 'cookie', 'set')
    .mockImplementation((value) => void written.push(value));
  const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi
      .spyOn(console, method)
      .mockImplementation((...args) => void logged.push(args.map(String).join(' '))),
  );
  return {
    leaks(secret: string): string[] {
      return [...stored, ...written, ...logged].filter((entry) => entry.includes(secret));
    },
    recorded: () => stored.length + written.length + logged.length,
    stop() {
      setItem.mockRestore();
      cookie.mockRestore();
      for (const spy of consoles) spy.mockRestore();
    },
  };
}
