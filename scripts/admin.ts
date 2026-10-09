import { runAdminCli } from '@/server/auth/admin/cli';
import { processIo } from '@/server/auth/admin/io';
import { registerBillingAccountHook } from '@/server/billing/account';
import { BILLING_USAGE, isBillingCommand, runBillingAdminCli } from '@/server/billing/admin-cli';
import { closeDb } from '@/server/db';
import { getLogger } from '@/server/logger';

// `npm run admin -- <command>`: operator tasks that have no UI (create or promote an admin, grant
// credits, disable accounts, reset passwords, list users, and the billing commands: list orders,
// refund, settle, price list). `npm run admin -- --help` lists them.
try {
  const args = process.argv.slice(2);
  // Deleting an account from here must end its subscription and withdraw its payment pages too.
  registerBillingAccountHook();
  if (isBillingCommand(args[0])) {
    process.exitCode = await runBillingAdminCli(args);
  } else {
    process.exitCode = await runAdminCli(args);
    if (args.length === 0 || ['--help', '-h', 'help'].includes(args[0] ?? '')) {
      processIo.out(`\n${BILLING_USAGE}`);
    }
  }
} catch (error) {
  getLogger().error('Admin command crashed', { err: error });
  process.exitCode = 1;
} finally {
  closeDb();
}
