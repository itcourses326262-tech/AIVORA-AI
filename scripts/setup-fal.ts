// `npm run setup:fal`: stores your fal key safely in `.env.local` (git-ignored) and proves it works.
//
//   npm run setup:fal                 asks for the key (typing is hidden), saves it, offers a test image
//   npm run setup:fal -- --no-test    only save it
//   npm run setup:fal -- --yes        do not ask before the test image (it costs about USD 0.003)
//   npm run setup:fal -- --file <p>   write to another env file (default ./.env.local)
//   npm run setup:fal -- --budget <n> daily upstream spend cap in credits written when none is set (default 200)
//
// The key is never printed, never put on the command line and never written anywhere but the env file.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { runFalCheck, upsertEnv, validateFalKey } from './lib/fal-check';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const option = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const target = path.resolve(process.cwd(), option('--file') ?? '.env.local');
const budget = option('--budget') ?? '200';

function createPrompter() {
  const interactive = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: interactive,
  });
  let muted = false;
  if (interactive) {
    // Hide what is typed while a secret is requested; keep the line break.
    (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (
      text: string,
    ) => {
      if (!muted) process.stdout.write(text);
      else if (/[\r\n]/.test(text)) process.stdout.write('\n');
    };
  }
  // Lines may arrive in one burst (a paste, a piped file) before the next question is asked, so
  // every line goes through a queue instead of being matched to one `question` call.
  const queue: string[] = [];
  let waiting: ((line: string) => void) | undefined;
  let closed = false;
  rl.on('line', (line) => {
    // Stay muted here: the rest of a pasted burst is processed before the next question is asked.
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(line);
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve('');
    }
  });
  return {
    ask(question: string, secret = false): Promise<string> {
      const queued = queue.shift();
      if (queued !== undefined) {
        process.stdout.write(`${question}\n`);
        muted = secret;
        return Promise.resolve(queued);
      }
      if (closed) return Promise.resolve('');
      return new Promise((resolve) => {
        waiting = resolve;
        muted = false; // the prompt itself must be visible
        rl.setPrompt(question);
        rl.prompt();
        muted = secret;
      });
    },
    isClosed: () => closed && queue.length === 0,
    close: () => rl.close(),
  };
}

function gitIgnores(file: string): boolean | undefined {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: path.dirname(file), stdio: 'ignore' });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return status === 1 ? false : undefined;
  }
}

async function main(): Promise<number> {
  console.log('AIVORE: connect fal.ai\n');
  console.log(`The key will be saved in: ${target}`);
  console.log(
    'It stays on this computer. Below I check that git ignores it, so it cannot be uploaded.\n',
  );

  const prompter = createPrompter();
  // A stray Enter (or a leftover line from pasting several commands at once) arrives as an empty
  // line: ignore it and ask again instead of giving up.
  let entered = '';
  for (let attempt = 0; attempt < 5 && entered.trim() === ''; attempt += 1) {
    entered = await prompter.ask(
      attempt === 0
        ? 'Paste your fal key (nothing will show while you paste), then press Enter: '
        : 'No key received yet. Paste it here and press Enter: ',
      true,
    );
    if (prompter.isClosed()) break;
  }
  if (entered.trim() === '') {
    prompter.close();
    console.log(
      '\nNothing was saved: no key arrived. Run the command again, wait until the prompt above appears, and only then paste the key (one command at a time).',
    );
    return 1;
  }
  const checked = validateFalKey(entered);
  if (!checked.ok) {
    prompter.close();
    console.log(`\nNothing was saved. ${checked.problem}`);
    return 1;
  }

  const previous = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const updates: Record<string, string> = { FAL_KEY: checked.key };
  if (!/^\s*DAILY_UPSTREAM_BUDGET_CREDITS\s*=/m.test(previous))
    updates.DAILY_UPSTREAM_BUDGET_CREDITS = budget;
  writeFileSync(target, upsertEnv(previous, updates), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(target, 0o600);
  } catch {
    // Windows has no POSIX modes; the file lives in your own user folder.
  }
  console.log('\nSaved FAL_KEY.');
  if (updates.DAILY_UPSTREAM_BUDGET_CREDITS !== undefined) {
    console.log(
      `Also set DAILY_UPSTREAM_BUDGET_CREDITS=${budget}: the most credits the app will spend at fal per day (raise it later).`,
    );
  }

  const ignored = gitIgnores(target);
  if (ignored === false) {
    console.log(
      '\nWARNING: git does NOT ignore this file. Do not commit it. Add ".env*" to .gitignore first.',
    );
  } else if (ignored === true) {
    console.log('Checked: git ignores this file, so it cannot be committed by accident.');
  }

  let runTest = !has('--no-test');
  if (runTest && !has('--yes')) {
    const answer = (
      await prompter.ask('\nRun one real test image now? It costs about USD 0.003 at fal. [Y/n] ')
    )
      .trim()
      .toLowerCase();
    runTest = answer === '' || answer === 'y' || answer === 'yes';
  }
  prompter.close();

  if (!runTest) {
    console.log('\nDone. Restart the site (npm run dev) so it reads the new key.');
    return 0;
  }

  console.log('');
  const result = await runFalCheck({ key: checked.key });
  if (result.ok) {
    const size = result.width && result.height ? `${result.width}x${result.height}, ` : '';
    console.log(
      `\nOK: fal works. Saved ${result.file} (${size}${result.bytes} bytes, ${result.ms} ms).`,
    );
    console.log('Now (re)start the site with: npm run dev   (PowerShell: npm.cmd run dev)');
    console.log(
      'In the Studio, pick FLUX.1 Schnell and generate. Write prompts in English for best results.',
    );
    return 0;
  }
  console.log(`\nThe key was saved, but the test failed (${result.reason}).\n${result.advice}`);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
