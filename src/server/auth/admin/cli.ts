import 'server-only';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { isAppError } from '@/lib/errors';
import {
  UsageError,
  createUser,
  disableUser,
  enableUser,
  grantCreditsTo,
  listUsers,
  resetPassword,
  setRole,
  type CommandContext,
} from './commands';
import { processIo, type CliIo } from './io';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const USAGE = `AIVORE admin tool

Usage: npm run admin -- <command> [options]

Commands:
  create-user     --email <email> [--name <name>] [--locale ar|en] [--role user|admin]
                  [--credits <n>] [--password-stdin | --password <value>]
  grant-credits   --email <email> --amount <n> [--note <text>]
  set-role        --email <email> --role user|admin [--force]
  disable         --email <email> [--force]      also signs the user out everywhere
  enable          --email <email>
  list-users      [--limit <n>] [--search <text>] [--json]
  reset-password  --email <email> [--password-stdin | --password <value>]
                  signs the user out everywhere

Passwords are read, in this order, from --password-stdin (first line of stdin), --password,
the AIVORE_ADMIN_PASSWORD environment variable, or a hidden prompt. Avoid --password: it
stays in your shell history.

Exit codes: 0 done, 1 the command failed (unknown user, rejected input, database error),
2 wrong usage.`;

interface CommandSpec {
  options: NonNullable<ParseArgsConfig['options']>;
  run: (context: CommandContext) => void | Promise<void>;
}

const email = { email: { type: 'string' } } as const;
const password = {
  password: { type: 'string' },
  'password-stdin': { type: 'boolean' },
} as const;

const COMMANDS: Record<string, CommandSpec> = {
  'create-user': {
    options: {
      ...email,
      ...password,
      name: { type: 'string' },
      locale: { type: 'string' },
      role: { type: 'string' },
      credits: { type: 'string' },
    },
    run: createUser,
  },
  'grant-credits': {
    options: { ...email, amount: { type: 'string' }, note: { type: 'string' } },
    run: grantCreditsTo,
  },
  'set-role': {
    options: { ...email, role: { type: 'string' }, force: { type: 'boolean' } },
    run: setRole,
  },
  disable: { options: { ...email, force: { type: 'boolean' } }, run: disableUser },
  enable: { options: email, run: enableUser },
  'list-users': {
    options: {
      limit: { type: 'string' },
      search: { type: 'string' },
      json: { type: 'boolean' },
    },
    run: listUsers,
  },
  'reset-password': { options: { ...email, ...password }, run: resetPassword },
};

/**
 * Runs one admin command and returns the process exit code. Nothing in here exits the process
 * or reads globals, so tests drive it with a fake {@link CliIo}.
 */
export async function runAdminCli(args: string[], io: CliIo = processIo): Promise<number> {
  const [name, ...rest] = args;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.out(USAGE);
    return name === undefined ? EXIT_USAGE : EXIT_OK;
  }
  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!spec) {
    io.err(`Unknown command "${name}".\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  try {
    const parsed = parseArgs({ args: rest, options: spec.options, allowPositionals: false });
    const values: CommandContext['values'] = {};
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof value === 'string' || typeof value === 'boolean') values[key] = value;
    }
    await spec.run({ io, values });
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError || isParseError(error)) {
      io.err(`${(error as Error).message}\n\nRun with --help for usage.`);
      return EXIT_USAGE;
    }
    // Policy and lookup failures are the operator's problem to fix, not crashes.
    io.err(isAppError(error) ? `Failed: ${describe(error)}` : `Failed: ${errorMessage(error)}`);
    return EXIT_FAILED;
  }
}

function isParseError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describe(error: { message: string; details?: unknown }): string {
  const issues = (
    error.details as { issues?: Array<{ path: string; message: string }> } | undefined
  )?.issues;
  if (!issues?.length) return error.message;
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}
