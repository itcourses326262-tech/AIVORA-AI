import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bareBucketName,
  checkFirebaseConfig,
  findDownloadedKeys,
  hasLoginFields,
  looksLikeSnippetCode,
  maskedApiKey,
  missingFields,
  normalizePathInput,
  parseFirebaseConfig,
} from '../../scripts/lib/firebase-config';

// Fixtures are assembled at runtime: key-shaped literals are rejected by tests/security.
const API_KEY = ['AI', 'za', 'Sy', 'x'.repeat(33)].join('');
const APP_ID = '1:123456789012:web:0123456789abcdef01234567';
const FIELDS = {
  apiKey: API_KEY,
  authDomain: 'demo-project.firebaseapp.com',
  projectId: 'demo-project',
  storageBucket: 'demo-project.firebasestorage.app',
  appId: APP_ID,
};

/** The snippet the Firebase console shows, with fake values. */
const CONSOLE_SNIPPET = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "${API_KEY}",
  authDomain: "demo-project.firebaseapp.com",
  projectId: "demo-project",
  storageBucket: "demo-project.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "${APP_ID}",
  measurementId: "G-ABCDEF1234"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
`;

describe('parseFirebaseConfig', () => {
  it('reads the whole snippet from the console and ignores analytics', () => {
    expect(parseFirebaseConfig(CONSOLE_SNIPPET)).toEqual(FIELDS);
  });

  it('reads JSON', () => {
    expect(
      parseFirebaseConfig(JSON.stringify({ ...FIELDS, measurementId: 'G-1' }, null, 2)),
    ).toEqual(FIELDS);
    expect(parseFirebaseConfig(JSON.stringify(FIELDS))).toEqual(FIELDS);
  });

  it('reads single quotes, backticks, unquoted names, comments and trailing commas', () => {
    const text = `{ apiKey: '${API_KEY}', // the key
      authDomain: \`demo-project.firebaseapp.com\`,
      "projectId": "demo-project", /* id */
      storageBucket: 'demo-project.firebasestorage.app',
      appId: "${APP_ID}", }`;
    expect(parseFirebaseConfig(text)).toEqual(FIELDS);
  });

  it('does not take look-alike names for the real ones', () => {
    const text = `{ myapiKey: "wrong", apiKey: "${API_KEY}", app_id: "x", appIdentifier: "y", appId: "${APP_ID}" }`;
    const parsed = parseFirebaseConfig(text);
    expect(parsed.apiKey).toBe(API_KEY);
    expect(parsed.appId).toBe(APP_ID);
  });

  it('returns what it finds and nothing for text without a config', () => {
    expect(parseFirebaseConfig('')).toEqual({});
    expect(parseFirebaseConfig('hello world')).toEqual({});
    expect(parseFirebaseConfig('{ projectId: "demo-project" }')).toEqual({
      projectId: 'demo-project',
    });
  });

  it('never evaluates anything', () => {
    const marker = `__setup_firebase_evaluated_${Date.now()}`;
    parseFirebaseConfig(`{ apiKey: (globalThis.${marker} = "pwned"), projectId: "p" }`);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });
});

describe('missingFields and hasLoginFields', () => {
  it('lists what is missing, and the login needs four of the five', () => {
    expect(missingFields({})).toEqual([
      'apiKey',
      'authDomain',
      'projectId',
      'storageBucket',
      'appId',
    ]);
    expect(missingFields({ ...FIELDS, storageBucket: undefined })).toEqual(['storageBucket']);
    expect(hasLoginFields({ ...FIELDS, storageBucket: undefined })).toBe(true);
    expect(hasLoginFields({ ...FIELDS, appId: undefined })).toBe(false);
    expect(hasLoginFields({})).toBe(false);
  });
});

describe('checkFirebaseConfig', () => {
  it('accepts a real-looking config without complaints', () => {
    const result = checkFirebaseConfig(FIELDS);
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.config).toEqual(FIELDS);
  });

  it('normalises the bucket and the auth domain people copy', () => {
    const result = checkFirebaseConfig({
      ...FIELDS,
      storageBucket: 'gs://demo-project.firebasestorage.app/',
      authDomain: 'https://demo-project.firebaseapp.com/',
    });
    expect(result.problems).toEqual([]);
    expect(result.config.storageBucket).toBe('demo-project.firebasestorage.app');
    expect(result.config.authDomain).toBe('demo-project.firebaseapp.com');
  });

  it('accepts the older appspot bucket', () => {
    const result = checkFirebaseConfig({ ...FIELDS, storageBucket: 'demo-project.appspot.com' });
    expect(result.problems).toEqual([]);
  });

  it.each([
    [{ apiKey: '' }, 'apiKey'],
    [{ apiKey: 'short' }, 'apiKey'],
    [{ apiKey: `${API_KEY} extra` }, 'apiKey'],
    [{ authDomain: '' }, 'authDomain'],
    [{ authDomain: 'not a host' }, 'authDomain'],
    [{ projectId: '' }, 'projectId'],
    [{ projectId: 'Has Spaces' }, 'projectId'],
    [{ projectId: 'UPPER' }, 'projectId'],
    [{ appId: '' }, 'appId'],
    [{ appId: 'abc' }, 'appId'],
    [{ storageBucket: 'not a bucket!' }, 'storageBucket'],
  ])('rejects %j', (override, field) => {
    const result = checkFirebaseConfig({ ...FIELDS, ...override });
    expect(result.problems.join(' ')).toContain(field);
  });

  it('warns, without blocking, about a missing bucket and about odd combinations', () => {
    const noBucket = checkFirebaseConfig({ ...FIELDS, storageBucket: '' });
    expect(noBucket.problems).toEqual([]);
    expect(noBucket.warnings.join(' ')).toContain('storageBucket is missing');

    const foreignBucket = checkFirebaseConfig({
      ...FIELDS,
      storageBucket: 'other-thing.appspot.com',
    });
    expect(foreignBucket.problems).toEqual([]);
    expect(foreignBucket.warnings.join(' ')).toContain('project id');

    const foreignDomain = checkFirebaseConfig({ ...FIELDS, authDomain: 'other.firebaseapp.com' });
    expect(foreignDomain.problems).toEqual([]);
    expect(foreignDomain.warnings.join(' ')).toContain('different project');

    const custom = checkFirebaseConfig({ ...FIELDS, authDomain: 'login.example.com' });
    expect(custom.warnings).toEqual([]);
  });
});

describe('small helpers', () => {
  it('bareBucketName strips the schemes and slashes', () => {
    expect(bareBucketName(' gs://a.b/ ')).toBe('a.b');
    expect(bareBucketName('https://a.b//')).toBe('a.b');
    expect(bareBucketName('a.b')).toBe('a.b');
  });

  it('maskedApiKey never shows the whole key', () => {
    const masked = maskedApiKey(API_KEY);
    expect(masked).not.toContain(API_KEY);
    expect(masked).toContain('39 characters');
    expect(masked.startsWith('AIza')).toBe(true);
  });

  it('looksLikeSnippetCode spots the code around the config', () => {
    for (const line of [
      'const app = initializeApp(firebaseConfig);',
      'const analytics = getAnalytics(app);',
      '// Initialize Firebase',
      '/* x */',
      'import { getAnalytics } from "firebase/analytics";',
      'export default x;',
      '};',
      '}',
    ]) {
      expect(looksLikeSnippetCode(line), line).toBe(true);
    }
    for (const line of [
      '/home/me/Downloads/key.json',
      'C:\\Users\\me\\Downloads\\key.json',
      '~/Downloads/key.json',
      '"C:\\Users\\me\\key.json"',
      'key.json',
      '\\\\server\\share\\key.json',
    ]) {
      expect(looksLikeSnippetCode(line), line).toBe(false);
    }
  });
});

describe('normalizePathInput', () => {
  const posix = { platform: 'linux', home: '/home/me' } as const;
  const windows = { platform: 'win32', home: 'C:\\Users\\me' } as const;

  it.each([
    ['/data/key.json', '/data/key.json'],
    ['  /data/key.json  ', '/data/key.json'],
    ['"/data/my key.json"', '/data/my key.json'],
    ["'/data/my key.json'", '/data/my key.json'],
    ['\u201C/data/key.json\u201D', '/data/key.json'],
    ["& '/data/my key.json'", '/data/my key.json'],
    ['/data/my\\ key.json', '/data/my key.json'],
    ['/data/a\\(1\\).json', '/data/a(1).json'],
    ['file:///data/my%20key.json', '/data/my key.json'],
  ])('on macOS/Linux %s -> %s', (input, expected) => {
    expect(normalizePathInput(input, posix)).toBe(expected);
  });

  it('expands ~ to the home folder', () => {
    expect(normalizePathInput('~/Downloads/key.json', posix)).toBe('/home/me/Downloads/key.json');
    expect(normalizePathInput('~', posix)).toBe('/home/me');
    expect(normalizePathInput('~user/x', posix)).toBe('~user/x');
  });

  it('leaves Windows paths alone, with or without quotes', () => {
    const path = 'C:\\Users\\me\\Downloads\\demo-project-firebase-adminsdk-abc.json';
    expect(normalizePathInput(path, windows)).toBe(path);
    expect(normalizePathInput(`"${path}"`, windows)).toBe(path);
    expect(normalizePathInput(`& '${path}'`, windows)).toBe(path);
    const spaced = 'C:\\Users\\me\\My Files\\key (1).json';
    expect(normalizePathInput(`"${spaced}"`, windows)).toBe(spaced);
    expect(normalizePathInput('\\\\server\\share\\key.json', windows)).toBe(
      '\\\\server\\share\\key.json',
    );
  });

  it('turns a file URL with a drive letter into a Windows path', () => {
    expect(normalizePathInput('file:///C:/Users/me/key.json', windows)).toBe(
      'C:/Users/me/key.json',
    );
  });

  it('expands ~ with a backslash on Windows', () => {
    expect(normalizePathInput('~\\Downloads\\key.json', windows)).toMatch(/Downloads/);
  });
});

describe('findDownloadedKeys', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aivore-downloads-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the key files of the project, newest first, and ignores everything else', () => {
    const old = join(dir, 'demo-project-firebase-adminsdk-aaaaa-111.json');
    const fresh = join(dir, 'demo-project-firebase-adminsdk-bbbbb-222.json');
    writeFileSync(old, '{}');
    writeFileSync(fresh, '{}');
    utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
    writeFileSync(join(dir, 'other-project-firebase-adminsdk-ccccc-333.json'), '{}');
    writeFileSync(join(dir, 'demo-project-firebase-adminsdk-ddddd-444.txt'), '{}');
    mkdirSync(join(dir, 'demo-project-firebase-adminsdk-eeeee-555.json'));
    expect(findDownloadedKeys('demo-project', [dir])).toEqual([fresh, old]);
  });

  it('survives folders that do not exist', () => {
    expect(findDownloadedKeys('demo-project', [join(dir, 'nope'), dir])).toEqual([]);
  });
});
