import 'server-only';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { isAppError } from '@/lib/errors';
import {
  UsageError,
  createUser,
  deleteUser,
  disableUser,
  enableUser,
  forceVerify,
  grantCreditsTo,
  listUsers,
  purgeDeleted,
  resendVerification,
  resetPassword,
  setRole,
  usersStats,
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
  users-stats     [--json]                       accounts, confirmed emails, new sign-ups, credits
                  (also: users stats)
  resend-verification <email>                    mails a new confirmation link (no resend gap)
  force-verify    <email>                        confirms the address without the link; grants
                                                 the sign-up bonus if the account has none
  delete-user     <email> | --id <usr_...> [--yes] [--force]
                  deletes the account like the user's own request (without the password);
                  without --yes it only shows what would go. --force: even the last admin
  purge-deleted                                  finishes the clean-up of deleted accounts whose
                                                 files could not all be removed at the time

For resend-verification, force-verify and delete-user the email may be given as --email <email>
or as the first argument.

Passwords are read, in this order, from --password-stdin (first line of stdin), --password,
the AIVORE_ADMIN_PASSWORD environment variable, or a hidden prompt. Avoid --password: it
stays in your shell history.

Exit codes: 0 done, 1 the command failed (unknown user, rejected input, database error),
2 wrong usage.`;

interface CommandSpec {
  options: NonNullable<ParseArgsConfig['options']>;
  /** The first argument without a flag is this option (`force-verify me@example.com`). */
  positional?: 'email';
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
  'users-stats': { options: { json: { type: 'boolean' } }, run: usersStats },
  'resend-verification': { options: email, positional: 'email', run: resendVerification },
  'force-verify': { options: email, positional: 'email', run: forceVerify },
  'delete-user': {
    options: {
      ...email,
      id: { type: 'string' },
      yes: { type: 'boolean' },
      force: { type: 'boolean' },
    },
    positional: 'email',
    run: deleteUser,
  },
  'purge-deleted': { options: {}, run: purgeDeleted },
};

/**
 * Runs one admin command and returns the process exit code. Nothing in here exits the process
 * or reads globals, so tests drive it with a fake {@link CliIo}.
 */
export async function runAdminCli(args: string[], io: CliIo = processIo): Promise<number> {
  // `users stats` reads better than `users-stats`; both work.
  const [first, ...others] = args;
  const [name, ...rest] =
    first === 'users' && others[0] === 'stats' ? ['users-stats', ...others.slice(1)] : args;
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
    const parsed = parseArgs({
      args: rest,
      options: spec.options,
      allowPositionals: spec.positional !== undefined,
    });
    const values: CommandContext['values'] = {};
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof value === 'string' || typeof value === 'boolean') values[key] = value;
    }
    if (spec.positional !== undefined) {
      const [positional, ...extra] = parsed.positionals;
      if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);
      if (positional !== undefined) {
        if (values[spec.positional] !== undefined) {
          throw new UsageError(`Give --${spec.positional} or the argument, not both`);
        }
        values[spec.positional] = positional;
      }
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
