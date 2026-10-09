import { execFileSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeGcsServer, type FakeGcsServer } from '../server/storage/fake-gcs-server';
import {
  keyFragments,
  serviceAccountFixture,
  throwawayPrivateKey,
} from '../server/storage/service-account';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/setup-firebase.ts');
const TSX = join(ROOT, 'node_modules/tsx/dist/loader.mjs');

// Fixtures are assembled at runtime: key-shaped literals are rejected by tests/security.
const API_KEY = ['AI', 'za', 'Sy', 'x'.repeat(33)].join('');
const APP_ID = '1:123456789012:web:0123456789abcdef01234567';
const SNIPPET = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
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

let work: string; // the folder the script runs in: ./data and ./.env.local live here
let home: string; // a fake home folder: ~ and Downloads
let keyFile: string;
let envFile: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'aivore-setup-firebase-'));
  home = mkdtempSync(join(tmpdir(), 'aivore-home-'));
  keyFile = join(home, 'key file.json');
  writeFileSync(keyFile, JSON.stringify(serviceAccountFixture(), null, 2));
  envFile = join(work, '.env.local');
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

/** Runs the real script in `work` with `stdin` as piped input (not a terminal). */
function setup(
  stdin: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
  return new Promise((done, fail) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json'),
      ...extraEnv,
    };
    for (const name of ['STORAGE_DRIVER', 'STORAGE_LOCAL_DIR', 'DATABASE_PATH']) {
      if (!(name in extraEnv)) delete env[name];
    }
    const child = spawn(
      process.execPath,
      ['--import', TSX, '--conditions=react-server', SCRIPT, ...args],
      {
        cwd: work,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? -1, out }));
    child.stdin.end(stdin);
  });
}

const savedEnv = () => readFileSync(envFile, 'utf8');
const copiedKey = () => join(work, 'data', 'firebase-service-account.json');

function expectNothingSaved() {
  expect(existsSync(envFile)).toBe(false);
  expect(existsSync(join(work, 'data'))).toBe(false);
}

function expectNoLeak(text: string) {
  expect(text).not.toContain('PRIVATE KEY');
  for (const fragment of keyFragments(throwawayPrivateKey())) expect(text).not.toContain(fragment);
  expect(text).not.toContain('k'.repeat(30));
}

describe('npm run setup:firebase', () => {
  it('reads the pasted block, copies the key with mode 600 and writes only the path', async () => {
    const { code, out } = await setup(`${SNIPPET}${keyFile}\n`);
    expect(code).toBe(0);

    const saved = savedEnv();
    expect(saved).toContain(`FIREBASE_API_KEY=${API_KEY}`);
    expect(saved).toContain('FIREBASE_AUTH_DOMAIN=demo-project.firebaseapp.com');
    expect(saved).toContain('FIREBASE_PROJECT_ID=demo-project');
    expect(saved).toContain(`FIREBASE_APP_ID=${APP_ID}`);
    expect(saved).toContain('FIREBASE_STORAGE_BUCKET=demo-project.firebasestorage.app');
    expect(saved).toContain('FIREBASE_SERVICE_ACCOUNT_FILE=./data/firebase-service-account.json');
    // Nothing else of the snippet, and never the key itself.
    expect(saved).not.toContain('G-ABCDEF1234');
    expect(saved).not.toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expectNoLeak(saved);

    expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
    if (process.platform !== 'win32') {
      expect(statSync(copiedKey()).mode & 0o777).toBe(0o600);
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
    }

    expectNoLeak(out);
    expect(out).not.toContain(API_KEY);
    expect(out).toContain('Analytics is not used');
    expect(out).toContain('Storage Object Admin');
    expect(out).toContain('check:storage');
    expect(out).toContain('allow read, write: if false');
    expect(out).toContain('Google');
  }, 60_000);

  it('never switches storage by itself, and prints the steps instead', async () => {
    // Not interactively (even when every question is answered yes) ...
    const asked = await setup(`${SNIPPET}${keyFile}\ny\ny\ny\n`);
    expect(asked.code).toBe(0);
    expect(savedEnv()).not.toContain('STORAGE_DRIVER');
    expect(asked.out).toContain('No pictures are stored on this computer yet');
    expect(asked.out).toContain('Storage was left as it is');
    expect(asked.out).toContain('a. STORAGE_DRIVER=gcs npm run check:storage');
    expect(asked.out).toContain('b. STORAGE_DRIVER=gcs npm run migrate:media -- --apply');
    expect(asked.out).toMatch(/add this line to \.env\.local[^\n]*\n\s+STORAGE_DRIVER=gcs\n/);
    expect(asked.out).toContain("$env:STORAGE_DRIVER='gcs'");

    // ... and not under --yes.
    rmSync(envFile);
    rmSync(join(work, 'data'), { recursive: true });
    const auto = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
    expect(auto.code).toBe(0);
    expect(savedEnv()).not.toContain('STORAGE_DRIVER');
    expect(auto.out).toContain('Storage was left as it is');
  }, 60_000);

  it('takes everything from flags and asks nothing', async () => {
    const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
    expect(code).toBe(0);
    expect(savedEnv()).toContain('FIREBASE_PROJECT_ID=demo-project');
    expect(savedEnv()).not.toContain('STORAGE_DRIVER');
    expectNoLeak(out);
  }, 60_000);

  it('reads --config from a file and writes to --env', async () => {
    const configFile = join(home, 'config.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        apiKey: API_KEY,
        authDomain: 'demo-project.firebaseapp.com',
        projectId: 'demo-project',
        storageBucket: 'demo-project.firebasestorage.app',
        appId: APP_ID,
      }),
    );
    const other = join(work, 'custom.env');
    const { code } = await setup('', [
      '--config',
      configFile,
      '--file',
      keyFile,
      '--yes',
      '--env',
      other,
    ]);
    expect(code).toBe(0);
    expect(readFileSync(other, 'utf8')).toContain('FIREBASE_APP_ID=');
    expect(existsSync(envFile)).toBe(false);
  }, 60_000);

  it('also accepts --env-file when that file exists (Node reads that flag itself)', async () => {
    const other = join(work, 'custom.env');
    writeFileSync(other, 'APP_URL=http://localhost:3000\n');
    const { code } = await setup('', [
      '--config',
      SNIPPET,
      '--file',
      keyFile,
      '--yes',
      '--env-file',
      other,
    ]);
    expect(code).toBe(0);
    expect(readFileSync(other, 'utf8')).toContain('FIREBASE_APP_ID=');
    expect(existsSync(envFile)).toBe(false);
  }, 60_000);

  it('keeps the other settings, and running it twice changes nothing', async () => {
    writeFileSync(envFile, 'APP_URL=http://localhost:3000\n# keep me\nFIREBASE_PROJECT_ID=old\n');
    const args = ['--config', SNIPPET, '--file', keyFile, '--yes'];
    expect((await setup('', args)).code).toBe(0);
    const first = savedEnv();
    expect(first).toContain('APP_URL=http://localhost:3000');
    expect(first).toContain('# keep me');
    expect(first).toContain('FIREBASE_PROJECT_ID=demo-project');
    expect(first).not.toContain('FIREBASE_PROJECT_ID=old');
    // The second run reads the key from where the first one put it.
    expect((await setup('', ['--config', SNIPPET, '--file', copiedKey(), '--yes'])).code).toBe(0);
    expect(savedEnv()).toBe(first);
    expect(first.match(/^FIREBASE_API_KEY=/gm)).toHaveLength(1);
  }, 120_000);

  it('does not switch storage when pictures are already on this computer, and says what to do', async () => {
    writeFileSync(envFile, 'STORAGE_LOCAL_DIR=./pictures\n');
    mkdirSync(join(work, 'pictures', 'u', 'usr_a'), { recursive: true });
    writeFileSync(join(work, 'pictures', 'u', 'usr_a', 'ast_one.png'), 'x');
    const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
    expect(code).toBe(0);
    expect(savedEnv()).not.toContain('STORAGE_DRIVER=gcs');
    expect(out).toContain('NOT found until you have run: npm run migrate:media');
    expect(out).not.toContain('No pictures are stored on this computer yet');
  }, 60_000);

  it('ignores hidden bookkeeping files when deciding whether pictures exist', async () => {
    writeFileSync(envFile, 'STORAGE_LOCAL_DIR=./pictures\n');
    mkdirSync(join(work, 'pictures'), { recursive: true });
    writeFileSync(join(work, 'pictures', '.tmp-abc'), 'x');
    const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
    expect(code).toBe(0);
    expect(out).toContain('No pictures are stored on this computer yet');
  }, 60_000);

  it('leaves STORAGE_DRIVER alone with --no-storage', async () => {
    writeFileSync(envFile, 'STORAGE_DRIVER=s3\n');
    const { code } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--no-storage']);
    expect(code).toBe(0);
    expect(savedEnv()).toContain('STORAGE_DRIVER=s3');
    expect(savedEnv()).toContain('FIREBASE_STORAGE_BUCKET=demo-project.firebasestorage.app');
  }, 60_000);

  it('does not ask again when storage is already gcs', async () => {
    writeFileSync(envFile, 'STORAGE_DRIVER=gcs\n');
    const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile]);
    expect(code).toBe(0);
    expect(out).toContain('already gcs');
  }, 60_000);

  describe('the key file', () => {
    it('refuses a key of another project and saves nothing', async () => {
      writeFileSync(
        keyFile,
        JSON.stringify(serviceAccountFixture({ project_id: 'other-project' })),
      );
      const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
      expect(code).toBe(1);
      expect(out).toContain('"other-project"');
      expect(out).toContain('"demo-project"');
      expectNoLeak(out);
      expectNothingSaved();
    }, 60_000);

    it.each([
      ['a user credential instead of a service account', { type: 'authorized_user' }],
      ['no client_email', { client_email: undefined }],
      ['no private_key', { private_key: undefined }],
      ['a private_key that is not a key', { private_key: 'nonsense' }],
    ])(
      'refuses %s and saves nothing',
      async (_label, override) => {
        writeFileSync(keyFile, JSON.stringify(serviceAccountFixture(override)));
        const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
        expect(code).toBe(1);
        expect(out).toContain('Nothing was saved');
        expectNoLeak(out);
        expectNothingSaved();
      },
      60_000,
    );

    it('refuses a file that is not JSON, a folder and a missing file', async () => {
      for (const target of [join(home, 'notes.txt'), home, join(home, 'missing.json')]) {
        if (target.endsWith('notes.txt')) writeFileSync(target, 'hello, not json');
        const { code, out } = await setup('', ['--config', SNIPPET, '--file', target, '--yes']);
        expect(code).toBe(1);
        expect(out).toContain('Nothing was saved');
        expectNothingSaved();
      }
    }, 120_000);

    it('refuses a pasted key in place of the path, without echoing it', async () => {
      const oneLine = JSON.stringify(serviceAccountFixture());
      const { code, out } = await setup(`${SNIPPET}${oneLine}\n`);
      expect(code).toBe(1);
      expect(out).toContain('CONTENTS');
      expectNoLeak(out);
      expectNothingSaved();
    }, 60_000);

    it('accepts a path in quotes, in PowerShell drag-and-drop form and with ~', async () => {
      mkdirSync(join(home, 'keys'));
      writeFileSync(join(home, 'keys', 'a key.json'), readFileSync(keyFile));
      for (const typed of [`"${keyFile}"`, `& '${keyFile}'`, `'${keyFile}'`, '~/keys/a key.json']) {
        rmSync(join(work, 'data'), { recursive: true, force: true });
        rmSync(envFile, { force: true });
        const { code, out } = await setup(`${SNIPPET}${typed}\n`, ['--no-storage']);
        expect(code, `${typed}\n${out}`).toBe(0);
        expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
      }
    }, 180_000);

    it('offers the key it finds in the Downloads folder', async () => {
      mkdirSync(join(home, 'Downloads'));
      const found = join(home, 'Downloads', 'demo-project-firebase-adminsdk-abcde-0123456789.json');
      writeFileSync(found, readFileSync(keyFile));
      const { code, out } = await setup(`${SNIPPET}\n`, ['--no-storage']);
      expect(code, out).toBe(0);
      expect(out).toContain('demo-project-firebase-adminsdk-abcde-0123456789.json');
      expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
    }, 60_000);

    it('asks for the path again after a stray Enter or a wrong path', async () => {
      const { code } = await setup(`${SNIPPET}\n\n${join(home, 'nope.json')}\n${keyFile}\n`, [
        '--no-storage',
      ]);
      expect(code).toBe(0);
      expect(existsSync(copiedKey())).toBe(true);
    }, 60_000);

    it('gives up cleanly when no path ever arrives', async () => {
      const { code, out } = await setup(SNIPPET);
      expect(code).toBe(1);
      expect(out).toContain('no usable key file arrived');
      expectNothingSaved();
    }, 60_000);

    it('replaces an older copy of the key and keeps it private', async () => {
      mkdirSync(join(work, 'data'));
      writeFileSync(copiedKey(), 'old', { mode: 0o644 });
      const { code } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
      expect(code).toBe(0);
      expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
      if (process.platform !== 'win32') expect(statSync(copiedKey()).mode & 0o777).toBe(0o600);
    }, 60_000);
  });

  describe('the config', () => {
    it('asks for the values one by one when the block is skipped, with defaults', async () => {
      const typed = ['', 'demo-project', API_KEY, APP_ID, '', '', keyFile].join('\n') + '\n';
      const { code, out } = await setup(typed);
      expect(code, out).toBe(0);
      const saved = savedEnv();
      expect(saved).toContain('FIREBASE_AUTH_DOMAIN=demo-project.firebaseapp.com');
      expect(saved).toContain('FIREBASE_STORAGE_BUCKET=demo-project.firebasestorage.app');
      expect(saved).not.toContain('STORAGE_DRIVER=gcs');
    }, 60_000);

    it('asks only for what the pasted block lacks', async () => {
      const noAppId = SNIPPET.replace(/ {2}appId: .*\n/, '');
      const { code, out } = await setup(`${noAppId}${APP_ID}\n${keyFile}\n`, ['--no-storage']);
      expect(code, out).toBe(0);
      expect(out).toContain('Missing from the block: appId');
      expect(savedEnv()).toContain(`FIREBASE_APP_ID=${APP_ID}`);
    }, 60_000);

    it('refuses values that cannot be right, and saves nothing', async () => {
      const { code, out } = await setup('', [
        '--config',
        SNIPPET.replace(API_KEY, 'tooshort'),
        '--file',
        keyFile,
        '--yes',
      ]);
      expect(code).toBe(1);
      expect(out).toContain('apiKey');
      expectNothingSaved();
    }, 60_000);

    it('saves nothing when no config ever arrives', async () => {
      const { code, out } = await setup('');
      expect(code).toBe(1);
      expect(out).toContain('Nothing was saved');
      expectNothingSaved();
    }, 60_000);

    it('works without a bucket (sign-in only) and says storage is not set up', async () => {
      const noBucket = SNIPPET.replace(/ {2}storageBucket: .*\n/, '');
      const { code, out } = await setup(`${noBucket}\n\n${keyFile}\n`);
      // The bucket is asked for; pressing Enter takes the default for the project.
      expect(code, out).toBe(0);
      expect(savedEnv()).toContain('FIREBASE_STORAGE_BUCKET=demo-project.firebasestorage.app');
    }, 60_000);
  });

  describe('what it reads before it says anything about storage', () => {
    const pictures = (dir: string) => {
      mkdirSync(join(work, dir, 'u', 'usr_a'), { recursive: true });
      writeFileSync(join(work, dir, 'u', 'usr_a', 'ast_one.png'), 'x');
    };
    const flagList = () => ['--config', SNIPPET, '--file', keyFile, '--yes'];

    it('reads .env as well as .env.local, so a site configured in .env is not told it has nothing', async () => {
      // The repro of the review: media in ../media named only in .env, no .env.local at all.
      writeFileSync(join(work, '.env'), 'STORAGE_DRIVER=local\nSTORAGE_LOCAL_DIR=./pictures\n');
      pictures('pictures');
      const { code, out } = await setup('', flagList());
      expect(code).toBe(0);
      expect(out).toContain('Storage is currently: local (set in .env).');
      expect(out).toContain('WARNING: pictures and videos are already stored on this computer');
      expect(out).not.toContain('nothing to move');
      expect(savedEnv()).not.toContain('STORAGE_DRIVER');
    }, 60_000);

    it('lets .env.local win over .env, and the last line win inside a file', async () => {
      writeFileSync(join(work, '.env'), 'STORAGE_DRIVER=s3\n');
      writeFileSync(envFile, 'STORAGE_DRIVER=gcs\nSTORAGE_DRIVER=local\n');
      const { out } = await setup('', flagList());
      expect(out).toContain('Storage is currently: local (set in .env.local).');
    }, 60_000);

    it('says plainly that the pictures are in S3', async () => {
      writeFileSync(join(work, '.env'), 'STORAGE_DRIVER=s3\n');
      const { code, out } = await setup('', flagList());
      expect(code).toBe(0);
      expect(out).toContain('Storage is currently: s3 (set in .env).');
      expect(out).toContain('in the S3 bucket');
      expect(out).not.toContain('No pictures are stored on this computer');
    }, 60_000);

    it('counts the rows of the assets table too, wherever the files are', async () => {
      writeFileSync(join(work, '.env'), 'DATABASE_PATH=./site.db\nSTORAGE_LOCAL_DIR=./nowhere\n');
      const db = new Database(join(work, 'site.db'));
      db.exec('create table assets (id text primary key)');
      db.prepare('insert into assets (id) values (?)').run('ast_one');
      db.close();
      const { out } = await setup('', flagList());
      expect(out).toContain('WARNING: pictures and videos are already stored on this computer');
      expect(out).not.toContain('nothing to move');
    }, 60_000);

    it('takes a database without an assets table, or a missing one, for an empty site', async () => {
      writeFileSync(join(work, '.env'), 'DATABASE_PATH=./site.db\n');
      new Database(join(work, 'site.db')).close();
      expect((await setup('', flagList())).out).toContain('nothing to move');
      rmSync(join(work, 'site.db'));
      rmSync(join(work, 'data'), { recursive: true });
      expect((await setup('', flagList())).out).toContain('nothing to move');
    }, 120_000);

    it('keeps the file-first order: a variable in the shell only fills a gap', async () => {
      // `STORAGE_DRIVER=gcs npm run check:storage` stays set in a PowerShell session; it is not
      // what the site was configured with.
      writeFileSync(envFile, 'STORAGE_DRIVER=local\n');
      const { out } = await setup('', flagList(), { STORAGE_DRIVER: 'gcs' });
      expect(out).toContain('Storage is currently: local (set in .env.local).');
    }, 60_000);

    it('updates every duplicate of a name, so the last line the site loads is the new value', async () => {
      writeFileSync(
        envFile,
        '# mine\r\nFIREBASE_PROJECT_ID=old\r\nFAL_KEY=abc\r\n\r\nFIREBASE_PROJECT_ID=older\r\n',
      );
      const { code } = await setup('', [...flagList(), '--no-storage']);
      expect(code).toBe(0);
      const saved = savedEnv();
      expect(saved.match(/^FIREBASE_PROJECT_ID=/gm)).toHaveLength(2);
      expect([...saved.matchAll(/^FIREBASE_PROJECT_ID=(.*?)\r?$/gm)].map((m) => m[1])).toEqual([
        'demo-project',
        'demo-project',
      ]);
      expect(saved).toContain('# mine\r\n');
      expect(saved).toContain('FAL_KEY=abc');
    }, 60_000);
  });

  describe('--use-storage', () => {
    let server: FakeGcsServer;
    beforeEach(async () => {
      server = await startFakeGcsServer();
    });
    afterEach(async () => {
      await server.close();
    });
    const emulator = () => ({
      STORAGE_EMULATOR_HOST: server.host,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    });
    const flagList = () => ['--config', SNIPPET, '--file', keyFile, '--yes', '--use-storage'];

    it('runs the check:storage round trip, and only then switches', async () => {
      const { code, out } = await setup('', flagList(), emulator());
      expect(code, out).toBe(0);
      expect(out).toContain('Trying the bucket before switching');
      expect(out.match(/\.\.\. ok \(\d+ ms\)/g)).toHaveLength(7);
      expect(savedEnv()).toMatch(/^STORAGE_DRIVER=gcs$/m);
      expect(out).not.toContain('Storage was left as it is');
      expect(out).toContain('5. Check it: npm run check:storage');
      // It really went through the bucket, and cleaned up after itself.
      expect(server.requests.length).toBeGreaterThan(5);
      expect(server.objects.size).toBe(0);
      expectNoLeak(out);
    }, 60_000);

    it('does not switch when the bucket refuses the round trip, but keeps the other settings', async () => {
      server.failUploads(403, 10);
      const { code, out } = await setup('', flagList(), emulator());
      expect(code).toBe(1);
      expect(out).toContain('FAILED at "write 4096 random bytes" (permission)');
      expect(out).toContain('Storage Object Admin');
      expect(out).toContain('Storage was NOT switched');
      expect(savedEnv()).toContain('FIREBASE_PROJECT_ID=demo-project');
      expect(savedEnv()).not.toContain('STORAGE_DRIVER');
      expect(out).toContain('Storage was left as it is');
      expectNoLeak(out);
    }, 60_000);

    it('does not touch the bucket, nor switch, when pictures are on this computer', async () => {
      mkdirSync(join(work, 'data', 'media', 'u'), { recursive: true });
      writeFileSync(join(work, 'data', 'media', 'u', 'ast_one.png'), 'x');
      const { code, out } = await setup('', flagList(), emulator());
      expect(code).toBe(1);
      expect(out).toContain('Storage was NOT switched: pictures and videos are already stored');
      expect(savedEnv()).not.toContain('STORAGE_DRIVER');
      expect(server.requests).toEqual([]);
    }, 60_000);

    it('does not switch a site that uses S3', async () => {
      writeFileSync(envFile, 'STORAGE_DRIVER=s3\n');
      const { code, out } = await setup('', flagList(), emulator());
      expect(code).toBe(1);
      expect(out).toContain('Storage was NOT switched: the site stores its media in S3');
      expect(savedEnv()).toContain('STORAGE_DRIVER=s3');
      expect(server.requests).toEqual([]);
    }, 60_000);

    it('refuses to switch when the database cannot be read, instead of guessing', async () => {
      writeFileSync(join(work, '.env'), 'DATABASE_PATH=./broken.db\n');
      writeFileSync(join(work, 'broken.db'), 'this is not a database'.repeat(50));
      const { code, out } = await setup('', flagList(), emulator());
      expect(code).toBe(1);
      expect(out).toContain('the database could not be read');
      expect(savedEnv()).not.toContain('STORAGE_DRIVER');
    }, 60_000);

    it('has nothing to do when the site already uses the bucket', async () => {
      writeFileSync(envFile, 'STORAGE_DRIVER=gcs\n');
      const { code, out } = await setup('', flagList(), emulator());
      expect(code).toBe(0);
      expect(out).toContain('already gcs');
      expect(server.requests).toEqual([]);
    }, 60_000);

    it('cannot be combined with --no-storage', async () => {
      const { code, out } = await setup('', ['--use-storage', '--no-storage']);
      expect(code).toBe(2);
      expect(out).toContain('contradict');
      expectNothingSaved();
    }, 60_000);

    it('is listed in --help', async () => {
      expect((await setup('', ['--help'])).out).toContain('--use-storage');
    }, 60_000);
  });

  describe('the downloaded key file and the project folder', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'ignore' });
    const flags = ['--config', SNIPPET, '--yes', '--no-storage'];
    const adminsdk = 'demo-project-firebase-adminsdk-abcde-0123456789.json';

    it('does not look for keys in the project folder, only in Downloads', async () => {
      writeFileSync(join(work, adminsdk), readFileSync(keyFile));
      const { code, out } = await setup(`${SNIPPET}\n${keyFile}\n`, ['--no-storage']);
      expect(code, out).toBe(0);
      expect(out).not.toContain('Found a key file');
      expect(out).toContain('Path of the downloaded .json file');
    }, 60_000);

    it('warns loudly about a key git would commit, and moves it into ./data', async () => {
      git('init', '-q');
      writeFileSync(join(work, '.gitignore'), '/data\n.env*\n');
      const inRepo = join(work, 'my-key.json');
      writeFileSync(inRepo, readFileSync(keyFile));
      const { code, out } = await setup('', [...flags, '--file', inRepo]);
      expect(code, out).toBe(0);
      expect(out).toContain('WARNING: the downloaded key file is inside this project folder');
      expect(out).toContain('git does NOT ignore it');
      expect(out).toContain('my-key.json');
      expect(out).toContain('Moved: my-key.json is deleted');
      expect(existsSync(inRepo)).toBe(false);
      expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: work }).toString()).toBe(
        '?? .gitignore\n',
      );
      expectNoLeak(out);
    }, 60_000);

    it('asks first when it is run by a person, and leaves the file when the answer is no', async () => {
      git('init', '-q');
      const inRepo = join(work, 'my-key.json');
      writeFileSync(inRepo, readFileSync(keyFile));
      const { code, out } = await setup('n\n', [
        '--config',
        SNIPPET,
        '--file',
        inRepo,
        '--no-storage',
      ]);
      expect(code, out).toBe(0);
      expect(out).toContain('Move it to ./data/firebase-service-account.json now');
      expect(out).toContain('Left where it is');
      expect(existsSync(inRepo)).toBe(true);
    }, 60_000);

    it('also moves it when git cannot be asked, because a Docker build would take it', async () => {
      const inFolder = join(work, 'my-key.json');
      writeFileSync(inFolder, readFileSync(keyFile));
      const { code, out } = await setup('', [...flags, '--file', inFolder]);
      expect(code, out).toBe(0);
      expect(out).toContain('could not say whether it ignores it');
      expect(existsSync(inFolder)).toBe(false);
      expect(existsSync(copiedKey())).toBe(true);
    }, 60_000);

    it('leaves a key that git ignores alone (the names Google gives them are ignored)', async () => {
      git('init', '-q');
      writeFileSync(join(work, '.gitignore'), readFileSync(join(ROOT, '.gitignore')));
      const inRepo = join(work, adminsdk);
      writeFileSync(inRepo, readFileSync(keyFile));
      const { code, out } = await setup('', [...flags, '--file', inRepo]);
      expect(code, out).toBe(0);
      expect(out).not.toContain('inside this project folder');
      expect(out).toContain('still where you saved it');
      expect(existsSync(inRepo)).toBe(true);
    }, 60_000);

    it('has no opinion about a key outside the project folder', async () => {
      git('init', '-q');
      const { code, out } = await setup('', [...flags, '--file', keyFile]);
      expect(code, out).toBe(0);
      expect(out).not.toContain('inside this project folder');
      expect(existsSync(keyFile)).toBe(true);
    }, 60_000);
  });

  describe('git', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'ignore' });

    it('warns loudly when git would commit the key file or the env file', async () => {
      git('init', '-q');
      const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
      expect(code).toBe(0);
      expect(out).toContain('WARNING: git does NOT ignore the key file');
      expect(out).toContain('WARNING: git does NOT ignore this env file');
    }, 60_000);

    it('confirms when git ignores both', async () => {
      git('init', '-q');
      writeFileSync(join(work, '.gitignore'), '/data\n.env*\n');
      const { code, out } = await setup('', ['--config', SNIPPET, '--file', keyFile, '--yes']);
      expect(code).toBe(0);
      expect(out).toContain('git ignores the key file');
      expect(out).not.toContain('WARNING: git does NOT');
    }, 60_000);
  });

  describe('usage', () => {
    it('rejects unknown flags and flags without a value', async () => {
      for (const args of [['--bogus'], ['--file'], ['--config', '--yes']]) {
        const { code, out } = await setup('', args);
        expect(code).toBe(2);
        expect(out).toContain('usage:');
      }
      expectNothingSaved();
    }, 120_000);

    it('prints help', async () => {
      const { code, out } = await setup('', ['--help']);
      expect(code).toBe(0);
      expect(out).toContain('--no-storage');
    }, 60_000);

    it('prints only ASCII', async () => {
      const { out } = await setup(`${SNIPPET}${keyFile}\n`);
      expect(out).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
    }, 60_000);
  });
});
