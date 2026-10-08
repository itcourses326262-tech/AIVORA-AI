import 'server-only';

/** The CLI's window to the outside world, replaceable in tests. */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  /** Reads a secret from the terminal without echo, or the first line of piped stdin. */
  readSecret(prompt: string): Promise<string>;
  /** Value of an environment variable (the password may come from `AIVORE_ADMIN_PASSWORD`). */
  env(name: string): string | undefined;
}

async function readPipedLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Uint8Array));
    if (chunk.includes(10)) break;
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0]?.replace(/\r$/, '') ?? '';
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    let value = '';
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = (action: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      action();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(() => resolve(value));
        if (char === '\u0003') return finish(() => reject(new Error('Canceled')));
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

export const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readSecret: (prompt) => (process.stdin.isTTY ? readHidden(prompt) : readPipedLine()),
  env: (name) => process.env[name],
};
