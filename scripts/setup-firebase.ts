// `npm run setup:firebase`: connects the site to your Firebase project and writes the settings to
// `.env.local` (git-ignored). Google sign-in needs only the four public web identifiers; the
// project's Cloud Storage bucket also needs a service-account key file, so it is a second, optional
// step that the wizard asks about after the config summary (default: no).
//
//   npm run setup:firebase                        asks for the config block, then whether to also set
//                                                 up Cloud Storage (it needs the key file)
//   npm run setup:firebase -- --config <p|text>   the firebaseConfig block, as a file path or inline text
//   npm run setup:firebase -- --api-key <v> --auth-domain <v> --project-id <v> --app-id <v>
//                                                 the four public identifiers one by one, so ONE line
//                                                 sets Google sign-in up (nothing to paste or quote);
//                                                 each overrides the same value of --config
//   npm run setup:firebase -- --signin-only       Google sign-in only: no question, no key file, and
//                                                 STORAGE_DRIVER, the bucket and the key path in the env
//                                                 file stay as they are (--no-storage is the same)
//   npm run setup:firebase -- --file <path>       also Cloud Storage, no question: the downloaded
//                                                 service-account JSON
//   npm run setup:firebase -- --use-storage       also Cloud Storage, no question, and ALSO switch
//                                                 STORAGE_DRIVER to gcs, but only after the same round
//                                                 trip as `npm run check:storage` passed and only for a
//                                                 site with no pictures stored yet
//   npm run setup:firebase -- --yes               do not ask questions that have a safe default; the
//                                                 answer to the storage question is then no
//   npm run setup:firebase -- --env <path>        write to another env file (default ./.env.local)
//                                                 (--env-file also works, but Node itself reads that
//                                                 flag and fails when the file does not exist yet)
//
// The one-line form, for a shell where pasting a multi-line block is awkward (PowerShell):
//   npm.cmd run setup:firebase -- --signin-only --yes --api-key <v> --auth-domain <v> --project-id <v> --app-id <v>
//
// The web config is public (every browser receives it), so it is typed visibly. The service-account
// key is the one secret: it is validated, copied to ./data/firebase-service-account.json (mode 600)
// and only its PATH goes to the env file. Nothing from the key is printed or put on a command line.
// Without Storage the key file is not asked for, looked for, read or copied.
//
// STORAGE_DRIVER is never switched by default, not even under --yes: a site that flips to the bucket
// before its pictures were copied (`npm run migrate:media`) shows every old picture as missing, and a
// bucket nobody has tested yet fails every upload. The wizard prints the steps instead.
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from '@/server/env';
import { createGcsStorage } from '@/server/storage/gcs';
import {
  parseServiceAccount,
  readServiceAccount,
  ServiceAccountError,
} from '@/server/storage/gcs-credentials';
import { readEnvValue, upsertEnv, writePrivateFile } from './lib/env-file';
import {
  bareBucketName,
  checkFirebaseConfig,
  cleanFlagValue,
  findDownloadedKeys,
  hasLoginFields,
  looksLikeSnippetCode,
  maskedApiKey,
  missingFields,
  normalizePathInput,
  parseFirebaseConfig,
  VALUE_FLAGS,
  type FirebaseWebConfig,
} from './lib/firebase-config';
import { hasLocalMedia } from './lib/media-files';
import { createPrompter, gitIgnores, type Prompter } from './lib/prompt';
import { runStorageCheck } from './lib/storage-check';
import { countAssetRows, readStorageSettings, switchBlocker } from './lib/storage-state';

const USAGE = [
  'usage: npm run setup:firebase -- [--config <file|text>] [--yes] [--env <path>]',
  '                                  [--signin-only | --no-storage]',
  '                                  [--file <service-account.json>] [--use-storage]',
  '                                  [--api-key <v>] [--auth-domain <v>] [--project-id <v>] [--app-id <v>]',
  '--signin-only (alias --no-storage) configures Google sign-in alone and excludes --file and --use-storage.',
  '--api-key, --auth-domain, --project-id and --app-id give the public identifiers one by one (they',
  'override the same value of --config); with all four, nothing is asked.',
].join('\n');

const VALUE_FLAG_NAMES = Object.keys(VALUE_FLAGS);
const FLAGS_WITH_VALUE = ['--config', '--file', '--env', '--env-file', ...VALUE_FLAG_NAMES];
const FLAGS = [
  '--yes',
  '--signin-only',
  '--use-storage',
  '--no-storage',
  '--help',
  '-h',
  ...FLAGS_WITH_VALUE,
];

/** The flags that mean "Google sign-in only" (`--no-storage` is the older name) and "also Storage". */
const SIGNIN_FLAGS = ['--signin-only', '--no-storage'];
const STORAGE_FLAGS = ['--file', '--use-storage'];

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const option = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === undefined || value.startsWith('--') ? undefined : value;
};

const KEY_COPY = path.resolve(process.cwd(), 'data', 'firebase-service-account.json');
const KEY_COPY_SETTING = './data/firebase-service-account.json';
const MAX_KEY_FILE_BYTES = 64 * 1024;
const MAX_QUESTION_ATTEMPTS = 6;
const MAX_SKIPPED_LINES = 60;
/** The tail of a paste can still be on its way when the next question is shown (a terminal sends it in pieces). */
const PASTE_SETTLE_MS = 80;
/**
 * In a terminal a blank answer that arrives this soon after the question was drawn is a pasted blank
 * line (the console snippet has one after the closing brace), not a person pressing Enter: nobody
 * reads the question and answers in that time.
 */
const STRAY_ENTER_MS = 400;
const STORAGE_QUESTION =
  "Also use the project's Cloud Storage? It needs a service-account key file. [y/N] ";

function say(line = '') {
  console.log(line);
}

/**
 * How an argument we do not know is named in the error. What follows an `=` and anything that is not
 * a flag is never repeated: `--api-key=<value>` is the likeliest mistake and the value should not
 * land on the screen (or in a pasted bug report).
 */
function describeUnknown(arg: string): string {
  if (!arg.startsWith('-')) return 'a value without a flag in front of it';
  const [flag = arg, ...rest] = arg.split('=');
  if (rest.length > 0 && FLAGS_WITH_VALUE.includes(flag)) {
    return `${flag}=... (write a space instead of "=": ${flag} <value>)`;
  }
  return flag;
}

/** Why a flag list cannot be used, or undefined. */
function badUsage(): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (!FLAGS.includes(arg)) return `Unknown argument: ${describeUnknown(arg)}`;
    if (FLAGS_WITH_VALUE.includes(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) return `${arg} needs a value.`;
      if (VALUE_FLAG_NAMES.includes(arg)) {
        if (cleanFlagValue(value) === '') return `${arg} needs a value.`;
        if (args.indexOf(arg) !== index) return `${arg} was given twice.`;
      }
      index += 1;
    }
  }
  for (const signin of SIGNIN_FLAGS) {
    for (const storage of STORAGE_FLAGS) {
      if (has(signin) && has(storage)) {
        return `${signin} (Google sign-in only, no key file) and ${storage} (Cloud Storage) contradict each other.`;
      }
    }
  }
  return undefined;
}

/**
 * What the flags decide before anything is asked: `storage` (a key file or --use-storage was
 * given), `signin` (--signin-only, or --yes, whose answer to the storage question is no) or `ask`
 * (the question follows the config summary).
 */
type Mode = 'storage' | 'signin' | 'ask';

function modeFromFlags(auto: boolean): Mode {
  if (STORAGE_FLAGS.some(has)) return 'storage';
  if (SIGNIN_FLAGS.some(has) || auto) return 'signin';
  return 'ask';
}

function yes(answer: string, fallback: boolean): boolean {
  const word = answer.trim().toLowerCase();
  if (word === 'y' || word === 'yes') return true;
  if (word === 'n' || word === 'no') return false;
  return fallback;
}

/** The text of `--config`: a file when one exists at that path, otherwise the text itself. */
function readConfigFlag(value: string): string {
  const candidate = normalizePathInput(value);
  try {
    const info = statSync(candidate);
    if (info.isFile() && info.size <= MAX_KEY_FILE_BYTES) return readFileSync(candidate, 'utf8');
  } catch {
    // Not a file: it is the block itself.
  }
  return value;
}

function configIsComplete(text: string): boolean {
  const start = text.search(/(?:^|[^A-Za-z0-9_])["'`]?(?:apiKey|projectId)["'`]?\s*:/);
  return start >= 0 && text.slice(start).includes('}');
}

/** Reads a pasted block: several lines, up to its closing brace. Empty when the person skips it. */
async function readPastedBlock(prompter: Prompter): Promise<string> {
  let text = await prompter.ask(
    'Paste the firebaseConfig block here, then press Enter (or just press Enter to type the values one by one): ',
  );
  if (text.trim() === '') return '';
  for (let lines = 0; lines < 120 && !configIsComplete(text); lines += 1) {
    if (prompter.isClosed()) break;
    const next = await prompter.ask('');
    // A blank line ends a block that has no closing brace, but only once a value has been seen:
    // the console snippet starts with comments and empty lines.
    if (next.trim() === '' && Object.keys(parseFirebaseConfig(text)).length > 0) break;
    text += `\n${next}`;
  }
  // The rest of the pasted snippet (`initializeApp(...)`) is not an answer to the next question.
  if (process.stdin.isTTY) prompter.discardPending();
  return text;
}

async function askValue(
  prompter: Prompter,
  label: string,
  fallback?: string,
): Promise<string | undefined> {
  const suffix = fallback ? ` [${fallback}]` : '';
  for (let attempt = 0; attempt < MAX_QUESTION_ATTEMPTS; attempt += 1) {
    const answer = (await prompter.ask(`${label}${suffix}: `))
      .trim()
      .replace(/^["'`]|["'`,]+$/g, '');
    if (answer !== '' && !looksLikeSnippetCode(answer)) return answer;
    if (fallback && answer === '') return fallback;
    if (prompter.isClosed()) break;
  }
  return undefined;
}

/** The identifiers given on the command line (`--api-key` ...), without quotes around them. */
function configFromFlags(): Partial<FirebaseWebConfig> {
  const given: Partial<FirebaseWebConfig> = {};
  for (const [flag, field] of Object.entries(VALUE_FLAGS)) {
    const value = option(flag);
    if (value !== undefined) given[field] = cleanFlagValue(value);
  }
  return given;
}

/** `bucket`: ask for the storage bucket too when the block lacks it (only when Storage is wanted). */
async function collectConfig(
  prompter: Prompter,
  bucket: boolean,
): Promise<{
  config: Partial<FirebaseWebConfig>;
  sawAnalytics: boolean;
} | null> {
  const flagged = option('--config');
  const given = configFromFlags();
  const givenCount = Object.keys(given).length;
  // Identifiers given one by one mean nobody is about to paste a block: nothing is waited for.
  const text =
    flagged !== undefined
      ? readConfigFlag(flagged)
      : givenCount > 0
        ? ''
        : await readPastedBlock(prompter);
  const fromBlock = parseFirebaseConfig(text);
  const config = { ...fromBlock, ...given };
  const sawAnalytics = /measurementId|getAnalytics/.test(text);
  if (Object.keys(fromBlock).length > 0) {
    say(`Read ${Object.keys(fromBlock).length} values from the config block.`);
  }
  if (givenCount > 0) {
    say(`Took ${givenCount} ${givenCount === 1 ? 'value' : 'values'} from the command line.`);
  }
  const absent = missingFields(config).filter((name) => bucket || name !== 'storageBucket');
  if (absent.length === 0) return { config, sawAnalytics };

  // Ask only for what the block did not contain, project id first because it makes the defaults.
  const order = (['projectId', 'apiKey', 'appId', 'authDomain', 'storageBucket'] as const).filter(
    (name) => absent.includes(name),
  );
  if (text.trim() !== '' || flagged !== undefined || givenCount > 0) {
    say(
      `Missing from the ${givenCount > 0 && text.trim() === '' ? 'command line' : 'block'}: ${order.join(', ')}. Type them in.`,
    );
  } else {
    say('Open Firebase console > Project settings > General > Your apps > Web app (SDK setup).');
  }
  for (const name of order) {
    if (!(await askConfigValue(prompter, config, name))) return null;
  }
  return { config, sawAnalytics };
}

/** Asks for one missing field into `config`. False (after saying so) when no value arrived. */
async function askConfigValue(
  prompter: Prompter,
  config: Partial<FirebaseWebConfig>,
  name: keyof FirebaseWebConfig,
): Promise<boolean> {
  const projectId = config.projectId;
  const fallback =
    name === 'authDomain' && projectId
      ? `${projectId}.firebaseapp.com`
      : name === 'storageBucket' && projectId
        ? `${projectId}.firebasestorage.app`
        : undefined;
  const value = await askValue(prompter, name, fallback);
  if (value === undefined) {
    say(`\nNothing was saved: no value for ${name} arrived. Run the command again.`);
    return false;
  }
  config[name] = value;
  return true;
}

/**
 * Waits a moment, then throws away what has arrived: the pieces of a pasted block can reach a
 * terminal one after the other, and its trailing Enter must not answer the next question.
 */
async function dropPasteTail(prompter: Prompter): Promise<void> {
  if (!process.stdin.isTTY) return;
  await new Promise((done) => setTimeout(done, PASTE_SETTLE_MS));
  prompter.discardPending();
}

/** "Also use Cloud Storage?" Enter means no: sign-in works without it and needs no secret. */
/** True or false for the answer, or null when the person aborted (Ctrl+C or Ctrl+D in a terminal). */
async function askUseStorage(prompter: Prompter): Promise<boolean | null> {
  await dropPasteTail(prompter);
  const terminal = Boolean(process.stdin.isTTY);
  for (
    let reads = 0, unclear = 0;
    reads < MAX_SKIPPED_LINES && unclear < MAX_QUESTION_ATTEMPTS;
    reads += 1
  ) {
    const askedAt = Date.now();
    const answer = await prompter.ask(STORAGE_QUESTION);
    const word = answer.trim().toLowerCase();
    // The terminal closed while waiting: Ctrl+C or Ctrl+D is an abort, not "no" (piped input that
    // simply ends still means no).
    if (terminal && word === '' && prompter.isClosed()) return null;
    // Leftover lines of a pasted snippet are not an answer, neither is an Enter that has more
    // lines behind it (a person pressing Enter has nothing behind it), nor one that arrives
    // before anyone could have read the question.
    const strayEnter =
      word === '' &&
      (prompter.pendingCount() > 0 || (terminal && Date.now() - askedAt < STRAY_ENTER_MS));
    if (looksLikeSnippetCode(answer) || strayEnter) {
      if (prompter.isClosed()) break;
      continue;
    }
    if (word === '' || ['y', 'yes', 'n', 'no'].includes(word)) return yes(word, false);
    say('Please answer y or n.');
    unclear += 1;
    if (prompter.isClosed()) break;
  }
  return false;
}

type KeyFile = { bytes: Buffer; projectId: string; source: string };

/** Reads and checks one candidate key file. Returns the reason in words, never any content. */
function inspectKeyFile(rawInput: string, projectId: string): KeyFile | string {
  const typed = rawInput.trim();
  if (typed.startsWith('{')) {
    return 'That is the CONTENTS of the key file; I need the PATH of the file (drag the file into this window).';
  }
  const source = path.resolve(normalizePathInput(typed));
  let info;
  try {
    info = statSync(source);
  } catch {
    return 'No file found at that path. Check the spelling, or drag the file into this window.';
  }
  if (info.isDirectory()) return 'That is a folder; I need the key file itself (a .json file).';
  if (info.size > MAX_KEY_FILE_BYTES) return 'That file is too large to be a service-account key.';
  let bytes: Buffer;
  try {
    bytes = readFileSync(source);
  } catch {
    return 'That file could not be read (permissions?).';
  }
  try {
    const account = parseServiceAccount(bytes.toString('utf8'), 'The key file');
    if (account.project_id !== projectId) {
      return `The key file belongs to project "${account.project_id}", but the web config is for "${projectId}". Download the key from the same Firebase project.`;
    }
    return { bytes, projectId: account.project_id, source };
  } catch (error) {
    if (error instanceof ServiceAccountError) return error.message;
    throw error;
  }
}

async function chooseKeyFile(
  prompter: Prompter,
  projectId: string,
  auto: boolean,
): Promise<KeyFile | null> {
  const flagged = option('--file');
  if (flagged !== undefined) {
    const result = inspectKeyFile(flagged, projectId);
    if (typeof result === 'string') {
      say(`\nNothing was saved. ${result}`);
      return null;
    }
    return result;
  }

  // Only the Downloads folder is searched. The project folder is deliberately not: a key found there
  // is already where `git add -A` and a Docker build would take it, so it is not offered as a source.
  const found = findDownloadedKeys(projectId, [path.join(os.homedir(), 'Downloads')])[0];
  if (found) {
    say(`Found a key file for this project: ${path.basename(found)} (in ${path.dirname(found)}).`);
    const answer = auto ? 'y' : await prompter.ask('Use it? [Y/n] ');
    if (yes(answer, true)) {
      const result = inspectKeyFile(found, projectId);
      if (typeof result !== 'string') return result;
      say(result);
    }
  }

  say('\nNow the service-account key: Firebase console > Project settings > Service accounts >');
  say('"Generate new private key". It downloads a .json file. Keep it secret.');
  // Stray Enters and the leftover code lines of a paste are skipped without using up an attempt.
  for (
    let reads = 0, wrong = 0;
    reads < MAX_SKIPPED_LINES && wrong < MAX_QUESTION_ATTEMPTS;
    reads += 1
  ) {
    const answer = await prompter.ask(
      wrong === 0
        ? 'Path of the downloaded .json file (drag the file into this window): '
        : 'Path of the .json file: ',
    );
    if (answer.trim() === '' || looksLikeSnippetCode(answer)) {
      if (prompter.isClosed()) break;
      continue;
    }
    const result = inspectKeyFile(answer, projectId);
    if (typeof result !== 'string') return result;
    say(result);
    wrong += 1;
    if (prompter.isClosed()) break;
  }
  say('\nNothing was saved: no usable key file arrived. Run the command again.');
  return null;
}

function installKeyFile(key: KeyFile): 'copied' | 'already-there' {
  mkdirSync(path.dirname(KEY_COPY), { recursive: true });
  if (existsSync(KEY_COPY) && realpathSync(KEY_COPY) === realpathSync(key.source)) {
    writePrivateFile(KEY_COPY, key.bytes);
    return 'already-there';
  }
  // Created with 0600 straight away: a copy made with the default mode would be readable by
  // other users of the computer for a moment.
  writePrivateFile(KEY_COPY, key.bytes);
  return 'copied';
}

/** True when `file` is `folder` or lies below it (links resolved). */
function isInside(folder: string, file: string): boolean {
  const relative = path.relative(realpathSync(folder), realpathSync(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The downloaded original may sit in the project folder (the browser saved it there, or it was
 * dragged in). The copy in ./data is ignored by git; the original is not, unless its name happens to
 * match a pattern in .gitignore, and `git add -A` or a Docker build would take it. Warns loudly and
 * offers to move it: the copy already made becomes the only one.
 */
async function guardOriginal(prompter: Prompter, key: KeyFile, auto: boolean): Promise<void> {
  if (path.resolve(key.source) === KEY_COPY) return;
  const ignored = isInside(process.cwd(), key.source) ? gitIgnores(key.source) : true;
  if (ignored === true) {
    say('The downloaded original is still where you saved it: delete it once everything works.');
    return;
  }
  const where = path.relative(process.cwd(), key.source);
  say(
    ignored === false
      ? '\nWARNING: the downloaded key file is inside this project folder and git does NOT ignore it:'
      : '\nWARNING: the downloaded key file is inside this project folder and git could not say whether it ignores it:',
  );
  say(`  ${where}`);
  say(
    '`git add -A` would commit your private key, and a Docker build would copy it into the image.',
  );
  const answer = auto
    ? 'y'
    : await prompter.ask(
        `Move it to ${KEY_COPY_SETTING} now (the copy stays, this file is deleted)? [Y/n] `,
      );
  if (!yes(answer, true)) {
    say('Left where it is. Delete it, or add it to .gitignore, BEFORE you commit anything.');
    return;
  }
  try {
    unlinkSync(key.source);
    say(`Moved: ${where} is deleted, the copy in ${KEY_COPY_SETTING} stays.`);
  } catch {
    say(`Could not delete ${where}. Delete it by hand before you commit anything.`);
  }
}

/** The same write / read / range / delete round trip as `npm run check:storage`, for the new bucket. */
async function bucketWorks(bucket: string): Promise<boolean> {
  try {
    const account = readServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FILE: KEY_COPY });
    const storage = createGcsStorage(
      parseEnv({
        NODE_ENV: 'development',
        STORAGE_DRIVER: 'gcs',
        FIREBASE_STORAGE_BUCKET: bucket,
        FIREBASE_SERVICE_ACCOUNT_FILE: KEY_COPY,
      }),
    );
    const result = await runStorageCheck({
      storage,
      target: { driver: 'gcs', where: bucket, serviceAccountEmail: account.client_email },
      secrets: [account.private_key],
    });
    if (result.ok) return true;
    say(`\nFAILED at "${result.step}" (${result.reason}): ${result.advice}`);
  } catch (error) {
    // Messages from the key checks never contain key material.
    say(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
  return false;
}

/** Whether git would commit the env file, and the one setting that keeps the Google button hidden. */
function reportEnvFile(target: string, previous: string): void {
  const envIgnored = gitIgnores(target);
  if (envIgnored === false) {
    say(
      'WARNING: git does NOT ignore this env file. Do not commit it. Add ".env*" to .gitignore first.',
    );
  } else if (envIgnored === true) {
    say('Checked: git ignores this file, so it cannot be committed by accident.');
  }
  if (readEnvValue(previous, 'FIREBASE_AUTH')?.toLowerCase() === 'off') {
    say('Note: FIREBASE_AUTH=off is set in this file, so the Google button stays hidden.');
    say('Remove that line (or set it to auto) to show it.');
  }
}

/**
 * Google sign-in without Storage: writes the four public identifiers and nothing else. The key
 * file, the bucket and STORAGE_DRIVER are not asked for, looked at, copied or mentioned, and lines
 * the env file already has for them stay exactly as they are.
 */
function saveSignInOnly(config: FirebaseWebConfig, target: string): number {
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const updates: Record<string, string> = {
    FIREBASE_API_KEY: config.apiKey,
    FIREBASE_AUTH_DOMAIN: config.authDomain,
    FIREBASE_PROJECT_ID: config.projectId,
    FIREBASE_APP_ID: config.appId,
  };
  writePrivateFile(target, upsertEnv(previous, updates));
  say(`\nSaved ${Object.keys(updates).join(', ')}.`);
  reportEnvFile(target, previous);

  say('\nWhat is left to do (in the Firebase console, project "' + config.projectId + '"):');
  say('  1. Build > Authentication > Get started > Sign-in method: enable "Google".');
  say('  2. Authentication > Settings > Authorized domains: add the domain of your site');
  say('     (localhost is there already).');
  say('  3. A running npm run dev picks the settings up by itself within a few seconds;');
  say('     otherwise restart it: npm run dev   (PowerShell: npm.cmd run dev)');
  const hasStorage =
    readEnvValue(previous, 'FIREBASE_SERVICE_ACCOUNT_FILE') !== undefined ||
    readEnvValue(previous, 'STORAGE_DRIVER') === 'gcs';
  say(
    hasStorage
      ? '\nThe Storage settings in this file were left exactly as they are.'
      : '\nTo add Cloud Storage later, run npm run setup:firebase again and answer y (or pass --file);\nPowerShell: npm.cmd run setup:firebase.',
  );
  return 0;
}

async function main(): Promise<number> {
  if (has('--help') || has('-h')) {
    say(USAGE);
    return 0;
  }
  const problem = badUsage();
  if (problem) {
    say(`${problem}\n${USAGE}`);
    return 2;
  }
  const target = path.resolve(
    process.cwd(),
    option('--env') ?? option('--env-file') ?? '.env.local',
  );
  const auto = has('--yes');
  if (has('--no-storage') && !has('--signin-only')) {
    say('Note: --no-storage now means --signin-only: no key file is read and none is needed.');
  }
  const mode = modeFromFlags(auto);

  say(
    mode === 'storage'
      ? 'AIVORE: connect Firebase (Google sign-in and Cloud Storage)\n'
      : mode === 'signin'
        ? 'AIVORE: connect Google sign-in (Firebase)\n'
        : 'AIVORE: connect Firebase (Google sign-in, and Cloud Storage if you want it)\n',
  );
  say(`Settings will be saved in: ${target}`);
  if (mode === 'storage') {
    say('The web config below is public (every visitor receives it). The key file is secret and');
    say('stays on this computer.\n');
  } else {
    say('The web config below is public (every visitor receives it).\n');
  }

  const prompter = createPrompter();
  try {
    // The bucket is only asked for when Storage is wanted; with the question still to come it is
    // asked for after the answer.
    const collected = await collectConfig(prompter, mode === 'storage');
    if (!collected) return 1;
    const first = checkFirebaseConfig(collected.config, { storage: mode === 'storage' });
    if (first.problems.length > 0) {
      say('\nNothing was saved. The config has problems:');
      for (const line of first.problems) say(`  - ${line}`);
      return 1;
    }
    let config = first.config;
    for (const line of first.warnings) say(`Note: ${line}`);
    say('\nFirebase project:');
    say(`  projectId      ${config.projectId}`);
    say(`  authDomain     ${config.authDomain}`);
    say(`  appId          ${config.appId}`);
    say(`  apiKey         ${maskedApiKey(config.apiKey)}`);
    if (mode !== 'signin') {
      say(`  storageBucket  ${bareBucketName(collected.config.storageBucket ?? '') || '(none)'}`);
    }
    if (collected.sawAnalytics) {
      say('Analytics is not used: measurementId and getAnalytics are ignored.');
    }
    if (!hasLoginFields(config)) {
      say('\nNothing was saved: the sign-in settings are incomplete.');
      return 1;
    }

    let storage = mode === 'storage';
    if (mode === 'ask') {
      say();
      const answer = await askUseStorage(prompter);
      if (answer === null) {
        say('\nNothing was saved.');
        return 1;
      }
      storage = answer;
      if (storage) {
        say('The service-account key is secret and stays on this computer.');
        if (
          !collected.config.storageBucket &&
          !(await askConfigValue(prompter, collected.config, 'storageBucket'))
        ) {
          return 1;
        }
        const second = checkFirebaseConfig(collected.config);
        if (second.problems.length > 0) {
          say('\nNothing was saved. The config has problems:');
          for (const line of second.problems) say(`  - ${line}`);
          return 1;
        }
        config = second.config;
        for (const line of second.warnings) {
          if (!first.warnings.includes(line)) say(`Note: ${line}`);
        }
      }
    }
    if (!storage) return saveSignInOnly(config, target);

    const key = await chooseKeyFile(prompter, config.projectId, auto);
    if (!key) return 1;

    // Everything checked: from here on, files are written.
    const installed = installKeyFile(key);
    say(
      installed === 'copied'
        ? `\nCopied the key file to ${KEY_COPY_SETTING} (only you can read it).`
        : `\nThe key file is already at ${KEY_COPY_SETTING} (only you can read it).`,
    );
    const keyIgnored = gitIgnores(KEY_COPY);
    if (keyIgnored === false) {
      say(
        'WARNING: git does NOT ignore the key file. Do NOT commit it. Add "/data" to .gitignore now.',
      );
    } else if (keyIgnored === true) {
      say('Checked: git ignores the key file, so it cannot be committed by accident.');
    } else {
      say('Could not ask git whether it ignores the key file; make sure it is never committed.');
    }
    await guardOriginal(prompter, key, auto);

    const previous = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const updates: Record<string, string> = {
      FIREBASE_API_KEY: config.apiKey,
      FIREBASE_AUTH_DOMAIN: config.authDomain,
      FIREBASE_PROJECT_ID: config.projectId,
      FIREBASE_APP_ID: config.appId,
      FIREBASE_SERVICE_ACCOUNT_FILE: KEY_COPY_SETTING,
    };
    if (config.storageBucket) updates.FIREBASE_STORAGE_BUCKET = config.storageBucket;

    // STORAGE_DRIVER changes only on request (--use-storage), after the bucket passed the same round
    // trip as `npm run check:storage`, and never for a site that has pictures to move.
    const talkAboutStorage = Boolean(config.storageBucket);
    let switchedStorage = false;
    let refusedSwitch = false;
    if (has('--use-storage') && !config.storageBucket) {
      say(
        '\n--use-storage needs a storage bucket, and the config has none. Storage was NOT switched.',
      );
      refusedSwitch = true;
    }
    if (talkAboutStorage) {
      const settings = readStorageSettings({
        cwd: process.cwd(),
        files: [...new Set([path.resolve('.env'), path.resolve('.env.local'), target])],
      });
      say(
        `\nStorage is currently: ${settings.driver}${settings.driverFrom ? ` (set in ${settings.driverFrom})` : ' (the default)'}.`,
      );
      if (settings.driver === 's3') {
        say('Your pictures and videos are in the S3 bucket; nothing here copies them out of S3.');
      }
      const situation = {
        driver: settings.driver,
        files: settings.driver === 'local' && (await hasLocalMedia(settings.mediaDir)),
        assetRows: settings.driver === 'local' ? countAssetRows(settings.databasePath) : 0,
      };
      if (situation.driver === 'local' && (situation.files || (situation.assetRows ?? 0) > 0)) {
        say('WARNING: pictures and videos are already stored on this computer. Once the site uses');
        say('the bucket they are NOT found until you have run: npm run migrate:media -- --apply');
      } else if (situation.driver === 'local') {
        say('No pictures are stored on this computer yet, so there is nothing to move.');
      }
      if (settings.driver === 'gcs') {
        say('STORAGE_DRIVER is already gcs.');
      } else if (has('--use-storage')) {
        const blocker = switchBlocker(situation);
        if (blocker) {
          say(`Storage was NOT switched: ${blocker}.`);
          refusedSwitch = true;
        } else {
          say('\nTrying the bucket before switching (the same test as: npm run check:storage):');
          if (await bucketWorks(config.storageBucket)) {
            updates.STORAGE_DRIVER = 'gcs';
            switchedStorage = true;
          } else {
            say('Storage was NOT switched. Fix the cause above and run this command again.');
            refusedSwitch = true;
          }
        }
      }
    }

    writePrivateFile(target, upsertEnv(previous, updates));
    say(`Saved ${Object.keys(updates).join(', ')}.`);
    say('The key file itself is never written to the env file, only its path.');
    reportEnvFile(target, previous);

    say('\nWhat is left to do (in the Firebase console, project "' + config.projectId + '"):');
    say('  1. Build > Authentication > Get started > Sign-in method: enable "Google".');
    say('  2. Authentication > Settings > Authorized domains: add the domain of your site');
    say('     (localhost is there already).');
    if (config.storageBucket) {
      say('  3. Build > Storage > Get started. The bucket location cannot be changed later.');
      say('     Rules tab: replace the rules with   allow read, write: if false;');
      say(
        '     (the site reads and writes with its service account; visitors never touch the bucket).',
      );
      say(
        '  4. Google Cloud console > IAM: give the service account (client_email in the key file)',
      );
      say('     the role "Storage Object Admin" (on the project, or on this bucket only).');
      say(
        `  5. Check it: ${switchedStorage ? '' : 'STORAGE_DRIVER=gcs '}npm run check:storage   (PowerShell: ${switchedStorage ? '' : "$env:STORAGE_DRIVER='gcs'; "}npm.cmd run check:storage)`,
      );
      say('  6. Restart the site: npm run dev   (PowerShell: npm.cmd run dev)');
      if (talkAboutStorage && !switchedStorage) {
        const file = path.relative(process.cwd(), target) || target;
        say(
          '\nStorage was left as it is. Whenever you want the pictures in the bucket, in this order:',
        );
        say('  a. STORAGE_DRIVER=gcs npm run check:storage');
        say(
          '  b. STORAGE_DRIVER=gcs npm run migrate:media -- --apply   (only if you have pictures;',
        );
        say('     leave out --apply first to see the numbers)');
        say(`  c. Only when both passed, add this line to ${file} and restart the site:`);
        say('       STORAGE_DRIVER=gcs');
        say(
          "  PowerShell: $env:STORAGE_DRIVER='gcs' first, then npm.cmd run check:storage and npm.cmd run migrate:media; Remove-Item Env:STORAGE_DRIVER afterwards.",
        );
        say(
          '  A site with no pictures yet can let this wizard do (c): run it again with --use-storage.',
        );
      }
    } else {
      say('  3. Restart the site: npm run dev   (PowerShell: npm.cmd run dev)');
    }
    return refusedSwitch ? 1 : 0;
  } finally {
    prompter.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Messages from the key checks never contain key material; anything else is shown as is.
    say(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
