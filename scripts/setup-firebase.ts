// `npm run setup:firebase`: connects the site to your Firebase project (Google sign-in and the
// project's Cloud Storage bucket) and writes the settings to `.env.local` (git-ignored).
//
//   npm run setup:firebase                        asks for the config block and the key file
//   npm run setup:firebase -- --config <p|text>   the firebaseConfig block, as a file path or inline text
//   npm run setup:firebase -- --file <path>       the downloaded service-account JSON
//   npm run setup:firebase -- --yes               do not ask questions that have a safe default
//   npm run setup:firebase -- --use-storage       ALSO switch STORAGE_DRIVER to gcs, but only after the
//                                                 same round trip as `npm run check:storage` passed and
//                                                 only for a site with no pictures stored yet
//   npm run setup:firebase -- --no-storage        say nothing about STORAGE_DRIVER (it is never changed
//                                                 without --use-storage anyway)
//   npm run setup:firebase -- --env <path>        write to another env file (default ./.env.local)
//                                                 (--env-file also works, but Node itself reads that
//                                                 flag and fails when the file does not exist yet)
//
// The web config is public (every browser receives it), so it is typed visibly. The service-account
// key is the one secret: it is validated, copied to ./data/firebase-service-account.json (mode 600)
// and only its PATH goes to the env file. Nothing from the key is printed or put on a command line.
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
import { upsertEnv, writePrivateFile } from './lib/env-file';
import {
  checkFirebaseConfig,
  findDownloadedKeys,
  hasLoginFields,
  looksLikeSnippetCode,
  maskedApiKey,
  missingFields,
  normalizePathInput,
  parseFirebaseConfig,
  type FirebaseWebConfig,
} from './lib/firebase-config';
import { hasLocalMedia } from './lib/media-files';
import { createPrompter, gitIgnores, type Prompter } from './lib/prompt';
import { runStorageCheck } from './lib/storage-check';
import { countAssetRows, readStorageSettings, switchBlocker } from './lib/storage-state';

const USAGE = [
  'usage: npm run setup:firebase -- [--config <file|text>] [--file <service-account.json>]',
  '                                  [--yes] [--use-storage | --no-storage] [--env <path>]',
].join('\n');

const FLAGS_WITH_VALUE = ['--config', '--file', '--env', '--env-file'];
const FLAGS = ['--yes', '--use-storage', '--no-storage', '--help', '-h', ...FLAGS_WITH_VALUE];

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

function say(line = '') {
  console.log(line);
}

/** Why a flag list cannot be used, or undefined. */
function badUsage(): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (!FLAGS.includes(arg)) return `Unknown argument: ${arg}`;
    if (FLAGS_WITH_VALUE.includes(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) return `${arg} needs a value.`;
      index += 1;
    }
  }
  if (has('--use-storage') && has('--no-storage')) {
    return '--use-storage and --no-storage contradict each other.';
  }
  return undefined;
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

async function collectConfig(prompter: Prompter): Promise<{
  config: Partial<FirebaseWebConfig>;
  sawAnalytics: boolean;
} | null> {
  const flagged = option('--config');
  const text = flagged !== undefined ? readConfigFlag(flagged) : await readPastedBlock(prompter);
  const config = parseFirebaseConfig(text);
  const sawAnalytics = /measurementId|getAnalytics/.test(text);
  if (Object.keys(config).length > 0) {
    say(`Read ${Object.keys(config).length} values from the config block.`);
  }
  const absent = missingFields(config);
  if (absent.length === 0) return { config, sawAnalytics };

  // Ask only for what the block did not contain, project id first because it makes the defaults.
  const order = (['projectId', 'apiKey', 'appId', 'authDomain', 'storageBucket'] as const).filter(
    (name) => absent.includes(name),
  );
  if (text.trim() !== '' || flagged !== undefined) {
    say(`Missing from the block: ${order.join(', ')}. Type them in.`);
  } else {
    say('Open Firebase console > Project settings > General > Your apps > Web app (SDK setup).');
  }
  for (const name of order) {
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
      return null;
    }
    config[name] = value;
  }
  return { config, sawAnalytics };
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

  say('AIVORE: connect Firebase (Google sign-in and Cloud Storage)\n');
  say(`Settings will be saved in: ${target}`);
  say('The web config below is public (every visitor receives it). The key file is secret and');
  say('stays on this computer.\n');

  const prompter = createPrompter();
  try {
    const collected = await collectConfig(prompter);
    if (!collected) return 1;
    const checked = checkFirebaseConfig(collected.config);
    if (checked.problems.length > 0) {
      say('\nNothing was saved. The config has problems:');
      for (const line of checked.problems) say(`  - ${line}`);
      return 1;
    }
    const { config } = checked;
    for (const line of checked.warnings) say(`Note: ${line}`);
    say('\nFirebase project:');
    say(`  projectId      ${config.projectId}`);
    say(`  authDomain     ${config.authDomain}`);
    say(`  appId          ${config.appId}`);
    say(`  apiKey         ${maskedApiKey(config.apiKey)}`);
    say(`  storageBucket  ${config.storageBucket || '(none)'}`);
    if (collected.sawAnalytics) {
      say('Analytics is not used: measurementId and getAnalytics are ignored.');
    }
    if (!hasLoginFields(config)) {
      say('\nNothing was saved: the sign-in settings are incomplete.');
      return 1;
    }

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
    const talkAboutStorage = !has('--no-storage') && Boolean(config.storageBucket);
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
    const envIgnored = gitIgnores(target);
    if (envIgnored === false) {
      say(
        'WARNING: git does NOT ignore this env file. Do not commit it. Add ".env*" to .gitignore first.',
      );
    } else if (envIgnored === true) {
      say('Checked: git ignores this file, so it cannot be committed by accident.');
    }

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
