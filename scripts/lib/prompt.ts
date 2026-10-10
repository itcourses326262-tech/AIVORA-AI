// Line-based questions for the command-line helpers (`npm run setup:fal`, `npm run setup:firebase`).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

export interface Prompter {
  /** `secret` hides what is typed in a terminal. An empty question prints nothing (continuation). */
  ask(question: string, secret?: boolean): Promise<string>;
  /** Input has ended and every queued line has been used. */
  isClosed(): boolean;
  /** Throws away lines that already arrived but were not asked for (the tail of a paste). */
  discardPending(): number;
  /** How many lines have arrived and are waiting for a question. */
  pendingCount(): number;
  close(): void;
}

export function createPrompter(): Prompter {
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
        if (question !== '') process.stdout.write(`${question}\n`);
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
    discardPending: () => queue.splice(0, queue.length).length,
    pendingCount: () => queue.length,
    close: () => rl.close(),
  };
}

/** True / false when git can tell, undefined when git is missing or `file` is outside a repository. */
export function gitIgnores(file: string): boolean | undefined {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: path.dirname(file), stdio: 'ignore' });
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return status === 1 ? false : undefined;
  }
}
