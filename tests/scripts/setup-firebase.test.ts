import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

// Python's pty module gives the script a real terminal (stdin.isTTY, raw mode, echo) without a
// native dependency. The plan is a list of steps: wait for some text, pause, send pieces.
const PTY_DRIVER = String.raw`
import json, os, pty, select, signal, sys, time
plan = json.loads(sys.argv[1])
argv = json.loads(sys.argv[2])
cwd = sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execv(argv[0], argv)
out = b''
closed = False
deadline = time.time() + 80
def pump(seconds):
    global out, closed
    end = time.time() + seconds
    while not closed:
        left = end - time.time()
        if left <= 0:
            return
        ready, _, _ = select.select([fd], [], [], left)
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b''
            if not data:
                closed = True
                return
            out += data
mark = 0
for step in plan:
    wanted = step.get('waitFor')
    while wanted and wanted.encode() not in out[mark:] and not closed and time.time() < deadline:
        pump(0.05)
    pump(step.get('pause', 0))
    mark = len(out)
    for piece in step.get('send', []):
        os.write(fd, piece.encode())
        pump(step.get('gap', 0.02))
while not closed and time.time() < deadline:
    pump(0.1)
if not closed:
    os.kill(pid, signal.SIGKILL)
_, status = os.waitpid(pid, 0)
print(json.dumps({'code': os.waitstatus_to_exitcode(status) if closed else -1, 'out': out.decode('utf8', 'replace')}))
`;

function hasPty(): boolean {
  if (process.platform === 'win32') return false;
  return spawnSync('python3', ['-I', '-c', 'import pty']).status === 0;
}

interface PtyStep {
  waitFor?: string;
  pause?: number;
  send?: string[];
  gap?: number;
}

/** Runs the real script in a pseudo-terminal in `work` and plays `steps` against it. */
function ptySetup(steps: PtyStep[], args: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise((done, fail) => {
    const command = [
      process.execPath,
      '--import',
      TSX,
      '--conditions=react-server',
      SCRIPT,
      ...args,
    ];
    const child = spawn(
      'python3',
      ['-I', '-c', PTY_DRIVER, JSON.stringify(steps), JSON.stringify(command), work],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          TERM: 'xterm',
          TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', fail);
    child.on('close', () => {
      try {
        done(JSON.parse(stdout.trim().split('\n').pop() ?? '') as { code: number; out: string });
      } catch {
        fail(new Error(`the terminal driver gave no result: ${stderr || stdout}`));
      }
    });
  });
}

describe('npm run setup:firebase', () => {
  it('reads the pasted block, copies the key with mode 600 and writes only the path', async () => {
    const { code, out } = await setup(`${SNIPPET}y\n${keyFile}\n`);
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
    const asked = await setup(`${SNIPPET}y\n${keyFile}\ny\ny\ny\n`);
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

  it('leaves STORAGE_DRIVER alone unless --use-storage is given', async () => {
    writeFileSync(envFile, 'STORAGE_DRIVER=s3\n');
    const { code } = await setup('', ['--config', SNIPPET, '--file', keyFile]);
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
      const { code, out } = await setup(`${SNIPPET}y\n${oneLine}\n`);
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
        const { code, out } = await setup(`${SNIPPET}y\n${typed}\n`);
        expect(code, `${typed}\n${out}`).toBe(0);
        expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
      }
    }, 180_000);

    it('offers the key it finds in the Downloads folder', async () => {
      mkdirSync(join(home, 'Downloads'));
      const found = join(home, 'Downloads', 'demo-project-firebase-adminsdk-abcde-0123456789.json');
      writeFileSync(found, readFileSync(keyFile));
      const { code, out } = await setup(`${SNIPPET}y\n`);
      expect(code, out).toBe(0);
      expect(out).toContain('demo-project-firebase-adminsdk-abcde-0123456789.json');
      expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
    }, 60_000);

    it('asks for the path again after a stray Enter or a wrong path', async () => {
      const { code } = await setup(`${SNIPPET}y\n\n${join(home, 'nope.json')}\n${keyFile}\n`);
      expect(code).toBe(0);
      expect(existsSync(copiedKey())).toBe(true);
    }, 60_000);

    it('gives up cleanly when no path ever arrives', async () => {
      const { code, out } = await setup(`${SNIPPET}y\n`);
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
      // The bucket is asked for after the answer to the storage question, not before it.
      const typed = ['', 'demo-project', API_KEY, APP_ID, '', 'y', '', keyFile].join('\n') + '\n';
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

    it('asks for the bucket only once Storage is wanted; Enter takes the default for the project', async () => {
      const noBucket = SNIPPET.replace(/ {2}storageBucket: .*\n/, '');
      const { code, out } = await setup(`${noBucket}y\n\n${keyFile}\n`);
      expect(code, out).toBe(0);
      expect(out).toContain('storageBucket [demo-project.firebasestorage.app]');
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
      const { code } = await setup('', flagList());
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

  describe('Google sign-in only (no key file)', () => {
    const ids = [
      'FIREBASE_API_KEY',
      'FIREBASE_AUTH_DOMAIN',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_APP_ID',
    ];
    const namesIn = (text: string) =>
      [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);

    /** Nothing about Storage or a key file may reach the screen or the disk. */
    function expectNoStorageTalk(out: string) {
      expect(out).not.toMatch(/key file|service-account|\.json|Downloads|Storage Object Admin/i);
      expect(out).not.toMatch(/STORAGE_DRIVER|check:storage|migrate:media|bucket/i);
      expect(out).not.toContain('[y/N]');
      expect(existsSync(join(work, 'data'))).toBe(false);
    }

    it.each(['--signin-only', '--no-storage'])(
      '%s writes the four public identifiers, asks nothing and prints the sign-in steps',
      async (flag) => {
        const { code, out } = await setup('', ['--config', SNIPPET, flag]);
        expect(code, out).toBe(0);

        const saved = savedEnv();
        expect(namesIn(saved)).toEqual(ids);
        expect(saved).toContain(`FIREBASE_API_KEY=${API_KEY}`);
        expect(saved).toContain('FIREBASE_AUTH_DOMAIN=demo-project.firebaseapp.com');
        expect(saved).toContain('FIREBASE_PROJECT_ID=demo-project');
        expect(saved).toContain(`FIREBASE_APP_ID=${APP_ID}`);
        if (process.platform !== 'win32') expect(statSync(envFile).mode & 0o777).toBe(0o600);

        // The one-line notice about the old flag name is the only place a key file is mentioned.
        expectNoStorageTalk(out.replace(/^Note: --no-storage now means .*\n/m, ''));
        expectNoLeak(out);
        expect(out).not.toContain(API_KEY);
        expect(out).toContain('Saved FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN');
        expect(out).toContain('Build > Authentication > Get started > Sign-in method');
        expect(out).toContain('Authorized domains');
        expect(out).toContain('picks the settings up by itself within a few seconds');
        expect(out).toContain('otherwise restart it: npm run dev   (PowerShell: npm.cmd run dev)');
        expect(out).toContain('To add Cloud Storage later, run npm run setup:firebase again');
        expect(out).toContain('answer y (or pass --file)');
        expect(out).toContain('npm.cmd run setup:firebase');
        expect(out).not.toContain('Restart the site');
      },
      60_000,
    );

    it('is the answer under --yes, and --file with --yes still means Storage', async () => {
      const auto = await setup('', ['--config', SNIPPET, '--yes']);
      expect(auto.code, auto.out).toBe(0);
      expect(namesIn(savedEnv())).toEqual(ids);
      expectNoStorageTalk(auto.out);

      rmSync(envFile);
      const withKey = await setup('', ['--config', SNIPPET, '--yes', '--file', keyFile]);
      expect(withKey.code, withKey.out).toBe(0);
      expect(savedEnv()).toContain('FIREBASE_SERVICE_ACCOUNT_FILE=');
      expect(existsSync(copiedKey())).toBe(true);
    }, 120_000);

    it('leaves every Storage line of the env file exactly as it was, and updates only the four', async () => {
      const before = [
        '# mine',
        'STORAGE_DRIVER=gcs',
        'FIREBASE_STORAGE_BUCKET=old-bucket.firebasestorage.app',
        'FIREBASE_SERVICE_ACCOUNT_FILE=./nowhere/at-all.json',
        'FIREBASE_PROJECT_ID=old',
        'FIREBASE_AUTH=auto',
        'APP_URL=http://localhost:3000',
        '',
      ].join('\n');
      writeFileSync(envFile, before);
      const { code, out } = await setup('', ['--config', SNIPPET, '--signin-only']);
      expect(code, out).toBe(0);
      const saved = savedEnv();
      for (const line of before.split('\n')) {
        if (line !== '' && !line.startsWith('FIREBASE_PROJECT_ID=')) expect(saved).toContain(line);
      }
      expect(saved).toContain('FIREBASE_PROJECT_ID=demo-project');
      expect(saved).not.toContain('FIREBASE_PROJECT_ID=old');
      expect(saved.match(/^STORAGE_DRIVER=/gm)).toHaveLength(1);
      expect(saved).not.toContain('demo-project.firebasestorage.app');
      // The unreadable key path is neither opened nor reported.
      expect(out).not.toContain('nowhere');
      expect(existsSync(join(work, 'data'))).toBe(false);
    }, 60_000);

    it('does not look for, offer or copy a key file that lies in Downloads', async () => {
      mkdirSync(join(home, 'Downloads'));
      const found = 'demo-project-firebase-adminsdk-abcde-0123456789.json';
      writeFileSync(join(home, 'Downloads', found), readFileSync(keyFile));
      const { code, out } = await setup('', ['--config', SNIPPET, '--signin-only']);
      expect(code, out).toBe(0);
      expect(out).not.toContain(found);
      expectNoStorageTalk(out);
    }, 60_000);

    it('never asks for the bucket, and a bucket that cannot be right does not matter', async () => {
      const noBucket = SNIPPET.replace(/ {2}storageBucket: .*\n/, '');
      const missing = await setup('', ['--config', noBucket, '--signin-only']);
      expect(missing.code, missing.out).toBe(0);
      expectNoStorageTalk(missing.out);
      expect(missing.out).not.toContain('Note:');

      rmSync(envFile);
      const broken = SNIPPET.replace('demo-project.firebasestorage.app', 'Not A Bucket!');
      const wrong = await setup('', ['--config', broken, '--signin-only']);
      expect(wrong.code, wrong.out).toBe(0);
      expect(namesIn(savedEnv())).toEqual(ids);
      expectNoStorageTalk(wrong.out);
    }, 120_000);

    it('still refuses a config that cannot sign anyone in, and saves nothing', async () => {
      const { code, out } = await setup('', [
        '--config',
        SNIPPET.replace(API_KEY, 'tooshort'),
        '--signin-only',
      ]);
      expect(code).toBe(1);
      expect(out).toContain('apiKey');
      expectNothingSaved();
    }, 60_000);

    it('says that FIREBASE_AUTH=off keeps the button hidden, and does not change it', async () => {
      writeFileSync(envFile, 'FIREBASE_AUTH=off\n');
      const { code, out } = await setup('', ['--config', SNIPPET, '--signin-only']);
      expect(code, out).toBe(0);
      expect(out).toContain('FIREBASE_AUTH=off is set in this file');
      expect(savedEnv()).toContain('FIREBASE_AUTH=off');
    }, 60_000);

    it('running it twice changes nothing', async () => {
      const args = ['--config', SNIPPET, '--signin-only'];
      expect((await setup('', args)).code).toBe(0);
      const first = savedEnv();
      expect((await setup('', args)).code).toBe(0);
      expect(savedEnv()).toBe(first);
    }, 120_000);

    it('contradicts --file and --use-storage, in either spelling, and saves nothing', async () => {
      for (const signin of ['--signin-only', '--no-storage']) {
        for (const storage of [['--file', keyFile], ['--use-storage']]) {
          const { code, out } = await setup('', ['--config', SNIPPET, signin, ...storage]);
          expect(code, `${signin} ${storage[0]}\n${out}`).toBe(2);
          expect(out).toContain(`${signin} (Google sign-in only, no key file)`);
          expect(out).toContain(`${storage[0]} (Cloud Storage) contradict each other`);
          expect(out).toContain('usage:');
          expectNothingSaved();
        }
      }
    }, 180_000);

    it('is listed in --help', async () => {
      expect((await setup('', ['--help'])).out).toContain('--signin-only');
    }, 60_000);
  });

  describe('the question "Also use the project\'s Cloud Storage?"', () => {
    const QUESTION =
      "Also use the project's Cloud Storage? It needs a service-account key file. [y/N]";

    it('is asked after the config summary, and Enter or end of input means no', async () => {
      for (const typed of [`${SNIPPET}\n`, SNIPPET, `${SNIPPET}n\n`, `${SNIPPET}NO\n`]) {
        rmSync(envFile, { force: true });
        const { code, out } = await setup(typed);
        expect(code, `${JSON.stringify(typed.slice(-6))}\n${out}`).toBe(0);
        expect(out.indexOf('Firebase project:')).toBeGreaterThan(-1);
        expect(out.indexOf(QUESTION)).toBeGreaterThan(out.indexOf('apiKey'));
        expect(savedEnv()).not.toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
        expect(savedEnv()).not.toContain('FIREBASE_STORAGE_BUCKET');
        expect(out).not.toContain('Path of the downloaded');
        expect(out).toContain('To add Cloud Storage later');
        expect(existsSync(join(work, 'data'))).toBe(false);
      }
    }, 240_000);

    it.each(['y', 'Y', 'yes', ' YES '])(
      'goes on to the key file after the answer %j',
      async (answer) => {
        const { code, out } = await setup(`${SNIPPET}${answer}\n${keyFile}\n`);
        expect(code, out).toBe(0);
        expect(out).toContain('Path of the downloaded .json file');
        expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
        expect(savedEnv()).toContain(
          'FIREBASE_SERVICE_ACCOUNT_FILE=./data/firebase-service-account.json',
        );
        expect(out).not.toContain('To add Cloud Storage later');
      },
      60_000,
    );

    it('asks again for an answer it cannot read, instead of guessing', async () => {
      const { code, out } = await setup(`${SNIPPET}maybe\nsure\ny\n${keyFile}\n`);
      expect(code, out).toBe(0);
      expect(out.match(/Please answer y or n\./g)).toHaveLength(2);
      expect(existsSync(copiedKey())).toBe(true);
    }, 60_000);

    it('is not answered by the lines that follow a pasted block', async () => {
      // After the closing brace the console snippet goes on with comments, imports, code and blank
      // lines; none of them is an answer, and a blank line with more lines behind it is not an Enter.
      const { code, out } = await setup(`${SNIPPET}\n\n// done\n\nyes\n${keyFile}\n`);
      expect(code, out).toBe(0);
      expect(existsSync(copiedKey())).toBe(true);
    }, 60_000);

    it('is not asked when a flag has answered it', async () => {
      for (const args of [['--signin-only'], ['--no-storage'], ['--yes'], ['--file', keyFile]]) {
        rmSync(envFile, { force: true });
        rmSync(join(work, 'data'), { recursive: true, force: true });
        const { code, out } = await setup('', ['--config', SNIPPET, ...args]);
        expect(code, `${args.join(' ')}\n${out}`).toBe(0);
        expect(out).not.toContain(QUESTION);
      }
    }, 240_000);
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
    const flags = ['--config', SNIPPET, '--yes'];
    const adminsdk = 'demo-project-firebase-adminsdk-abcde-0123456789.json';

    it('does not look for keys in the project folder, only in Downloads', async () => {
      writeFileSync(join(work, adminsdk), readFileSync(keyFile));
      const { code, out } = await setup(`${SNIPPET}y\n${keyFile}\n`);
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
      const { code, out } = await setup('n\n', ['--config', SNIPPET, '--file', inRepo]);
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

  // A person pastes the Firebase snippet into a real terminal: the lines arrive in a burst, the
  // pieces of it one after the other, and the paste ends with an Enter of its own. None of that may
  // answer the question that follows; only what is typed afterwards does.
  describe.skipIf(!hasPty())('in a real terminal (pseudo-terminal)', () => {
    /** The paste as a terminal sends it: Enter is a carriage return. Cut after the closing brace. */
    const cut = SNIPPET.indexOf('};') + 3;
    const [head, tail] = [SNIPPET.slice(0, cut), SNIPPET.slice(cut)].map((part) =>
      part.replace(/\n/g, '\r'),
    ) as [string, string];
    const paste = {
      waitFor: 'Paste the firebaseConfig block',
      send: [head, tail, '\r'],
      gap: 0.015,
    };

    it('waits for the person after a paste that arrives in pieces, then takes y', async () => {
      const { code, out } = await ptySetup([
        paste,
        { waitFor: '[y/N]', pause: 0.5, send: ['y\r'] },
        { waitFor: 'Path of the downloaded', send: [`${keyFile}\r`] },
      ]);
      expect(code, out).toBe(0);
      expect(out).toContain("Also use the project's Cloud Storage?");
      expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
      expect(savedEnv()).toContain(
        'FIREBASE_SERVICE_ACCOUNT_FILE=./data/firebase-service-account.json',
      );
      expectNoLeak(out);
    }, 90_000);

    it('takes the Enter of the person as no, and writes only the four identifiers', async () => {
      const { code, out } = await ptySetup([paste, { waitFor: '[y/N]', pause: 0.5, send: ['\r'] }]);
      expect(code, out).toBe(0);
      expect(savedEnv()).toContain('FIREBASE_APP_ID=');
      expect(savedEnv()).not.toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
      expect(out).not.toContain('Path of the downloaded');
      expect(out).toContain('To add Cloud Storage later');
      expect(existsSync(join(work, 'data'))).toBe(false);
    }, 90_000);

    it('asks nothing under --signin-only, even with the same paste', async () => {
      const { code, out } = await ptySetup([paste], ['--signin-only']);
      expect(code, out).toBe(0);
      expect(out).not.toContain('[y/N]');
      expect(savedEnv()).not.toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
    }, 90_000);

    it.each([
      ['Ctrl+C', '\x03'],
      ['Ctrl+D', '\x04'],
    ])(
      'treats %s at the Storage question as an abort: nothing is saved',
      async (_name, key) => {
        const { code, out } = await ptySetup([
          paste,
          { waitFor: '[y/N]', pause: 0.6, send: [key] },
        ]);
        expect(code, out).toBe(1);
        expect(out).toContain('Nothing was saved');
        expect(out).not.toContain('Saved FIREBASE_API_KEY');
        expect(existsSync(envFile)).toBe(false);
      },
      90_000,
    );

    it('does not take a blank line that arrives right after the question as the answer', async () => {
      // The console snippet has a blank line after the closing brace; a slow terminal can deliver it
      // after the question has been drawn. Only a person's later Enter or y answers.
      const { code, out } = await ptySetup([
        paste,
        { waitFor: '[y/N]', send: ['\r'] },
        { waitFor: '[y/N]', pause: 0.7, send: ['y\r'] },
        { waitFor: 'Path of the downloaded', send: [`${keyFile}\r`] },
      ]);
      expect(code, out).toBe(0);
      expect(out.split('[y/N]').length - 1).toBeGreaterThanOrEqual(2);
      expect(readFileSync(copiedKey())).toEqual(readFileSync(keyFile));
    }, 90_000);
  });

  describe('sign-in only: what it says afterwards', () => {
    it('offers to add Storage later when the env file has none', async () => {
      const { code, out } = await setup('', ['--config', SNIPPET, '--signin-only']);
      expect(code, out).toBe(0);
      expect(out).toContain('To add Cloud Storage later');
      expect(out).not.toContain('left exactly as they are');
    }, 60_000);

    it('does not tell someone who already has Storage how to add it', async () => {
      writeFileSync(
        envFile,
        'STORAGE_DRIVER=gcs\nFIREBASE_SERVICE_ACCOUNT_FILE=./data/firebase-service-account.json\n',
      );
      const { code, out } = await setup('', ['--config', SNIPPET, '--signin-only']);
      expect(code, out).toBe(0);
      expect(out).toContain('Storage settings in this file were left exactly as they are');
      expect(out).not.toContain('To add Cloud Storage later');
      expect(savedEnv()).toContain('STORAGE_DRIVER=gcs');
    }, 60_000);

    it('says that --no-storage now means --signin-only', async () => {
      const { code, out } = await setup('', ['--config', SNIPPET, '--no-storage']);
      expect(code, out).toBe(0);
      expect(out).toContain('--no-storage now means --signin-only');
      const plain = await setup('', ['--config', SNIPPET, '--signin-only']);
      expect(plain.out).not.toContain('--no-storage now means');
    }, 120_000);
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
