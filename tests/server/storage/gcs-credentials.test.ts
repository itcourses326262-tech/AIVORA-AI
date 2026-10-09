import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/env';
import { createGcsStorage } from '@/server/storage/gcs';
import {
  ServiceAccountError,
  parseServiceAccount,
  readServiceAccount,
} from '@/server/storage/gcs-credentials';
import { keyFragments, serviceAccountFixture, throwawayPrivateKey } from './service-account';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-sa-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (overrides: Parameters<typeof serviceAccountFixture>[0] = {}) =>
  JSON.stringify(serviceAccountFixture(overrides));

function writeKeyFile(content: string, name = 'sa.json') {
  const path = join(dir, name);
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}

/** Runs `work`, captures everything the process printed, and returns what it threw. */
function capture(work: () => unknown) {
  const printed: string[] = [];
  const sinks = [
    vi.spyOn(console, 'log').mockImplementation((...a) => void printed.push(a.join(' '))),
    vi.spyOn(console, 'error').mockImplementation((...a) => void printed.push(a.join(' '))),
    vi.spyOn(console, 'warn').mockImplementation((...a) => void printed.push(a.join(' '))),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    }),
  ];
  let thrown: unknown;
  try {
    work();
  } catch (error) {
    thrown = error;
  } finally {
    for (const sink of sinks) sink.mockRestore();
  }
  return { thrown, printed: printed.join('\n') };
}

/** Everything an error can carry to a log line or an error page. */
function everythingAbout(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    parts.push(current.name, current.message, current.stack ?? '');
    current = current.cause;
  }
  return parts.join('\n');
}

function expectNoLeak(text: string) {
  const key = throwawayPrivateKey();
  expect(text).not.toContain('PRIVATE KEY');
  for (const fragment of keyFragments(key)) expect(text).not.toContain(fragment);
  expect(text).not.toContain('k'.repeat(30));
}

describe('parseServiceAccount', () => {
  it('accepts a downloaded key file and keeps only what the SDK needs', () => {
    const parsed = parseServiceAccount(json(), 'SETTING');
    expect(parsed).toEqual({
      type: 'service_account',
      project_id: 'demo-project',
      client_email: 'firebase-adminsdk-test@demo-project.iam.gserviceaccount.com',
      private_key: throwawayPrivateKey(),
      private_key_id: 'k'.repeat(30),
    });
  });

  it('accepts pretty-printed JSON with surrounding whitespace', () => {
    const pretty = `\n  ${JSON.stringify(serviceAccountFixture(), null, 2)}\n\n`;
    expect(parseServiceAccount(pretty, 'SETTING').project_id).toBe('demo-project');
  });

  it('repairs raw line breaks inside the key, which a .env loader makes of "\\n"', () => {
    const expanded = json().replaceAll('\\n', '\n');
    expect(expanded).toContain('\n');
    expect(() => JSON.parse(expanded)).toThrow();
    expect(parseServiceAccount(expanded, 'SETTING').private_key).toBe(throwawayPrivateKey());
  });

  it.each([
    ['not json at all', 'is not a JSON object'],
    ['', 'is not a JSON object'],
    ['[1,2]', 'is not a JSON object'],
    ['"a string"', 'is not a JSON object'],
    ['null', 'is not a JSON object'],
  ])('rejects %j', (text, message) => {
    expect(() => parseServiceAccount(text, 'MY_SETTING')).toThrow(`MY_SETTING ${message}`);
  });

  it.each([
    [{ type: 'authorized_user' }, '"type"'],
    [{ type: undefined }, '"type"'],
    [{ project_id: undefined }, '"project_id"'],
    [{ project_id: '  ' }, '"project_id"'],
    [{ project_id: 5 }, '"project_id"'],
    [{ client_email: undefined }, '"client_email"'],
    [{ client_email: 'not an email' }, '"client_email"'],
    [{ private_key: undefined }, '"private_key"'],
    [{ private_key: '' }, '"private_key"'],
    [{ private_key: 'not a key' }, '"private_key"'],
  ])('names the field that is wrong: %j', (overrides, field) => {
    const { thrown } = capture(() => parseServiceAccount(json(overrides), 'MY_SETTING'));
    expect(thrown).toBeInstanceOf(ServiceAccountError);
    expect((thrown as Error).message).toContain('MY_SETTING');
    expect((thrown as Error).message).toContain(field);
  });

  it('never puts the key, or a piece of the file, in an error or in the output', () => {
    const broken = [
      json({ type: 'user' }),
      json({ client_email: 'broken' }),
      json({ project_id: undefined }),
      // Invalid JSON that still contains the key: JSON.parse would quote part of it.
      `{${json().slice(1, -1)} trailing`,
      json({ private_key: throwawayPrivateKey().slice(0, 200) }),
      json({ private_key: throwawayPrivateKey().replace(/[A-Za-z]{10}/, 'x') }),
    ];
    for (const text of broken) {
      const { thrown, printed } = capture(() => parseServiceAccount(text, 'MY_SETTING'));
      expect(thrown).toBeInstanceOf(ServiceAccountError);
      expectNoLeak(everythingAbout(thrown));
      expectNoLeak(printed);
      expect((thrown as Error).cause).toBeUndefined();
    }
  });
});

describe('readServiceAccount', () => {
  it('reads the file named by FIREBASE_SERVICE_ACCOUNT_FILE', () => {
    const path = writeKeyFile(json());
    expect(readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: path }).client_email).toContain(
      '@demo-project',
    );
  });

  it('resolves a relative path against the working directory', () => {
    writeKeyFile(json(), 'relative.json');
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      expect(
        readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: './relative.json' }).project_id,
      ).toBe('demo-project');
    } finally {
      spy.mockRestore();
    }
  });

  it('reads FIREBASE_SERVICE_ACCOUNT_JSON when there is no file setting', () => {
    expect(readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: json() }).project_id).toBe(
      'demo-project',
    );
  });

  it('prefers the file over the JSON, and never falls back to the JSON when the file is bad', () => {
    const path = writeKeyFile(json({ project_id: 'from-file' }));
    const both = {
      FIREBASE_SERVICE_ACCOUNT_FILE: path,
      FIREBASE_SERVICE_ACCOUNT_JSON: json({ project_id: 'from-json' }),
    };
    expect(readServiceAccount(both).project_id).toBe('from-file');
    expect(() =>
      readServiceAccount({ ...both, FIREBASE_SERVICE_ACCOUNT_FILE: join(dir, 'gone.json') }),
    ).toThrow('FIREBASE_SERVICE_ACCOUNT_FILE');
  });

  it('asks for a setting when none is given', () => {
    expect(() => readServiceAccount({})).toThrow('FIREBASE_SERVICE_ACCOUNT_FILE');
    expect(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: '  ' })).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_FILE',
    );
  });

  it('names the setting and the error code, not the path, when the file cannot be read', () => {
    const path = join(dir, 'secret-folder-name', 'missing.json');
    const { thrown } = capture(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: path }));
    expect(thrown).toBeInstanceOf(ServiceAccountError);
    expect((thrown as Error).message).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
    expect((thrown as Error).message).toContain('ENOENT');
    expect((thrown as Error).message).not.toContain('secret-folder-name');
    expect(everythingAbout(thrown)).not.toContain('secret-folder-name');
  });

  // Root reads anything, and Windows has no POSIX modes.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports an unreadable file without leaking anything',
    () => {
      const path = writeKeyFile(json());
      chmodSync(path, 0o000);
      const { thrown } = capture(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: path }));
      expect((thrown as Error).message).toContain('EACCES');
      expectNoLeak(everythingAbout(thrown));
    },
  );

  it('refuses a pasted key in the path setting without echoing it', () => {
    const { thrown, printed } = capture(() =>
      readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: json() }),
    );
    expect((thrown as Error).message).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expectNoLeak(everythingAbout(thrown));
    expectNoLeak(printed);
  });

  it('refuses a file that is far too big to be a key file, without reading it', () => {
    const path = writeKeyFile('x'.repeat(100 * 1024));
    expect(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: path })).toThrow('too large');
  });

  it('refuses a directory and a file that is not a key', () => {
    expect(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: dir })).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_FILE',
    );
    const notAKey = writeKeyFile('{"hello":"world"}', 'other.json');
    expect(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: notAKey })).toThrow('"type"');
  });

  it('names the file setting when the file content is wrong', () => {
    const path = writeKeyFile(json({ client_email: undefined }));
    const { thrown } = capture(() => readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: path }));
    expect((thrown as Error).message).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
    expect((thrown as Error).message).toContain('"client_email"');
    expect((thrown as Error).message).not.toContain(dir);
  });
});

describe('createGcsStorage reads the credentials when it is created', () => {
  const envWith = (extra: Record<string, string>) =>
    parseEnv({
      NODE_ENV: 'test',
      STORAGE_DRIVER: 'gcs',
      FIREBASE_STORAGE_BUCKET: 'demo-project.firebasestorage.app',
      ...extra,
    });

  it('accepts a good file and a good JSON setting', () => {
    const path = writeKeyFile(json());
    expect(() => createGcsStorage(envWith({ FIREBASE_SERVICE_ACCOUNT_FILE: path }))).not.toThrow();
    expect(() =>
      createGcsStorage(envWith({ FIREBASE_SERVICE_ACCOUNT_JSON: json() })),
    ).not.toThrow();
  });

  it('fails early, naming the setting, for every kind of bad key, and leaks nothing', () => {
    const cases: Array<Record<string, string>> = [
      { FIREBASE_SERVICE_ACCOUNT_JSON: 'not json' },
      { FIREBASE_SERVICE_ACCOUNT_JSON: json({ client_email: undefined }) },
      { FIREBASE_SERVICE_ACCOUNT_JSON: json({ private_key: 'garbage' }) },
      { FIREBASE_SERVICE_ACCOUNT_FILE: join(dir, 'nope.json') },
      { FIREBASE_SERVICE_ACCOUNT_FILE: writeKeyFile(json({ type: 'user' })) },
    ];
    for (const extra of cases) {
      const { thrown, printed } = capture(() => createGcsStorage(envWith(extra)));
      expect(thrown).toBeInstanceOf(ServiceAccountError);
      expect((thrown as Error).message).toMatch(/FIREBASE_SERVICE_ACCOUNT_(FILE|JSON)/);
      expectNoLeak(everythingAbout(thrown));
      expectNoLeak(printed);
    }
  });

  it('creating the driver never prints anything', () => {
    const { thrown, printed } = capture(() =>
      createGcsStorage(envWith({ FIREBASE_SERVICE_ACCOUNT_JSON: json() })),
    );
    expect(thrown).toBeUndefined();
    expect(printed).toBe('');
  });
});
