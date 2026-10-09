// Plain-text helpers for `.env`-style files, shared by the setup scripts. No file access except
// `writePrivateFile`.
import { chmodSync, writeFileSync } from 'node:fs';

/**
 * Sets `NAME=value` lines in the text of an env file: replaces EVERY existing line of a name (the
 * last assignment wins when the file is loaded, so a duplicate left behind would undo the update),
 * appends a missing one, keeps every other line and comment, and always ends with a newline. Pure:
 * no file access.
 */
export function upsertEnv(content: string, updates: Record<string, string>): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines =
    content === '' ? [] : content.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const missing = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name === undefined || !Object.hasOwn(updates, name)) return line;
    missing.delete(name);
    return `${name}=${updates[name] as string}`;
  });
  for (const [name, value] of missing) next.push(`${name}=${value}`);
  return next.join(eol) + eol;
}

/** The value of the last `NAME=value` line (quotes stripped), or undefined when unset or blank. */
export function readEnvValue(content: string, name: string): string | undefined {
  let found: string | undefined;
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match?.[1] !== name) continue;
    const value = (match[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
    found = value === '' ? undefined : value;
  }
  return found;
}

/** Writes a file only its owner can read, also when the file already existed with looser rights. */
export function writePrivateFile(file: string, data: string | Uint8Array): void {
  writeFileSync(file, data, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX modes; the file lives in your own user folder.
  }
}
