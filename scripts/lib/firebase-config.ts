// Shared by `npm run setup:firebase`: reading the `firebaseConfig` block the Firebase console shows
// and the path of the downloaded key file. Pure functions, no file access except `findDownloadedKeys`.
//
// Everything in the web config is public by design (it ships to every browser). The service-account
// key is the secret: nothing here ever returns, prints or logs its contents.
import { readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
}

export const CONFIG_FIELDS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'appId',
] as const satisfies ReadonlyArray<keyof FirebaseWebConfig>;

/** The ones the browser sign-in cannot work without; the bucket is only needed for storage. */
const REQUIRED_FOR_LOGIN = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;

/**
 * Reads `name: "value"` pairs out of whatever was pasted: the whole snippet from the console, the
 * object alone, JSON, with single or double quotes or backticks, with or without quotes around the
 * names, with comments and trailing commas. Nothing is evaluated.
 */
export function parseFirebaseConfig(text: string): Partial<FirebaseWebConfig> {
  const found: Partial<FirebaseWebConfig> = {};
  for (const name of CONFIG_FIELDS) {
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])["'\`]?${name}["'\`]?\\s*:\\s*(["'\`])(.*?)\\1`);
    const value = pattern.exec(text)?.[2]?.trim();
    if (value) found[name] = value;
  }
  return found;
}

/** The command-line flags that carry one of the four public identifiers, and the field each fills. */
export const VALUE_FLAGS = {
  '--api-key': 'apiKey',
  '--auth-domain': 'authDomain',
  '--project-id': 'projectId',
  '--app-id': 'appId',
} as const satisfies Record<string, keyof FirebaseWebConfig>;

/**
 * A value typed or pasted after a flag, without the quotes a shell did not remove (cmd.exe keeps
 * single quotes) and the comma copied along from a `name: "value",` line.
 */
export function cleanFlagValue(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+/, '')
    .replace(/["'`,]+$/, '')
    .trim();
}

/** True when every field the sign-in needs is present (the bucket may still be missing). */
export function hasLoginFields(config: Partial<FirebaseWebConfig>): boolean {
  return REQUIRED_FOR_LOGIN.every((name) => Boolean(config[name]));
}

/** The values the pasted block has not given yet, in the order they are asked. */
export function missingFields(config: Partial<FirebaseWebConfig>): Array<keyof FirebaseWebConfig> {
  return CONFIG_FIELDS.filter((name) => !config[name]);
}

/** `gs://name/` and `https://name` are what people copy; the setting wants the bare name. */
export function bareBucketName(value: string): string {
  return value
    .trim()
    .replace(/^(?:gs|https?):\/\//i, '')
    .replace(/\/+$/, '');
}

const PROJECT_ID = /^[a-z][a-z0-9-]{3,28}[a-z0-9]$/;
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const APP_ID = /^\d+:\d+:web:[0-9a-f]+$/i;

export interface ConfigCheck {
  config: FirebaseWebConfig;
  /** Reasons the values cannot be used; empty means they can. */
  problems: string[];
  /** Things that look unusual but may be intentional. */
  warnings: string[];
}

export interface CheckOptions {
  /**
   * Whether the bucket matters. Without Storage (sign-in only) it is neither checked nor kept: the
   * result has an empty `storageBucket` and no problem or warning about it. Default true.
   */
  storage?: boolean;
}

/** Checks the shape of the values (not that they exist at Google) and normalises the bucket name. */
export function checkFirebaseConfig(
  input: Partial<FirebaseWebConfig>,
  options: CheckOptions = {},
): ConfigCheck {
  const storage = options.storage ?? true;
  const problems: string[] = [];
  const warnings: string[] = [];
  const clean = (value: string | undefined) => (value ?? '').trim();

  const apiKey = clean(input.apiKey);
  const authDomain = clean(input.authDomain)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const projectId = clean(input.projectId);
  const storageBucket = storage ? bareBucketName(clean(input.storageBucket)) : '';
  const appId = clean(input.appId);

  if (apiKey === '') problems.push('apiKey is missing.');
  else if (/\s/.test(apiKey) || apiKey.length < 20 || apiKey.length > 100) {
    problems.push('apiKey does not look right: copy it again from the Firebase console.');
  }
  if (authDomain === '') problems.push('authDomain is missing.');
  else if (!HOSTNAME.test(authDomain)) {
    problems.push('authDomain should be a host name such as my-project.firebaseapp.com.');
  }
  if (projectId === '') problems.push('projectId is missing.');
  else if (!PROJECT_ID.test(projectId)) {
    problems.push('projectId does not look right (lowercase letters, digits and dashes).');
  }
  if (appId === '') problems.push('appId is missing.');
  else if (!APP_ID.test(appId)) {
    problems.push('appId should look like 1:123456789:web:abcdef0123456789.');
  }
  if (storage) {
    if (storageBucket === '') {
      warnings.push('storageBucket is missing: Google sign-in will work, Storage will not.');
    } else if (!BUCKET.test(storageBucket)) {
      problems.push('storageBucket is not a bucket name such as my-project.firebasestorage.app.');
    } else if (PROJECT_ID.test(projectId) && !storageBucket.startsWith(projectId)) {
      warnings.push(
        `storageBucket does not start with the project id (${projectId}): is it right?`,
      );
    }
  }
  if (HOSTNAME.test(authDomain) && PROJECT_ID.test(projectId)) {
    if (authDomain.endsWith('.firebaseapp.com') && authDomain !== `${projectId}.firebaseapp.com`) {
      warnings.push('authDomain belongs to a different project than projectId: is it right?');
    }
  }
  return { config: { apiKey, authDomain, projectId, storageBucket, appId }, problems, warnings };
}

/** The public identifiers hidden enough for a terminal log: `AIza...(39 characters)`. */
export function maskedApiKey(apiKey: string): string {
  return `${apiKey.slice(0, 4)}... (${apiKey.length} characters)`;
}

export interface PathContext {
  platform?: NodeJS.Platform;
  home?: string;
}

/**
 * Turns what a person typed or dragged into a terminal into a path: surrounding quotes (also the
 * curly ones), PowerShell's `& 'path'` drag-and-drop form, `file://` links, `~` for the home
 * folder, and on macOS/Linux the backslash before spaces. Windows backslashes stay untouched.
 */
export function normalizePathInput(raw: string, context: PathContext = {}): string {
  const platform = context.platform ?? process.platform;
  const home = context.home ?? os.homedir();
  let value = raw.trim();
  value = value.replace(/^&\s+/, '');
  const quote = /^(["'‘“])(.*)(["'’”])$/.exec(value);
  if (quote) value = (quote[2] ?? '').trim();
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    } catch {
      // Not a valid link: use it as typed.
    }
  }
  if (platform !== 'win32') value = value.replace(/\\(?=[ ()'"&])/g, '');
  if (value === '~') return home;
  if (/^~[\\/]/.test(value)) return path.join(home, value.slice(2));
  return value;
}

/** Lines of a pasted snippet that are code around the config, not an answer to a question. */
export function looksLikeSnippetCode(line: string): boolean {
  return (
    /^\s*(?:\/\/|\/\*|\*\/?|const\s|let\s|var\s|import\s|export\s|\}\s*;?\s*$)/.test(line) ||
    /initializeApp\(|getAnalytics\(|getAuth\(|getStorage\(/.test(line)
  );
}

/** Files Firebase names `<project>-firebase-adminsdk-<id>-<hash>.json`, newest first. */
export function findDownloadedKeys(projectId: string, folders: string[]): string[] {
  const hits: Array<{ file: string; time: number }> = [];
  for (const folder of folders) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(`${projectId}-firebase-adminsdk`) || !name.endsWith('.json')) continue;
      const file = path.join(folder, name);
      try {
        const info = statSync(file);
        if (info.isFile()) hits.push({ file, time: info.mtimeMs });
      } catch {
        // Vanished meanwhile.
      }
    }
  }
  return hits.sort((a, b) => b.time - a.time).map((hit) => hit.file);
}
