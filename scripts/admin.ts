import { runAdminCli } from '@/server/auth/admin/cli';
import { closeDb } from '@/server/db';
import { getLogger } from '@/server/logger';

// `npm run admin -- <command>`: operator tasks that have no UI (create or promote an admin, grant
// credits, disable accounts, reset passwords, list users). `npm run admin -- --help` lists them.
try {
  process.exitCode = await runAdminCli(process.argv.slice(2));
} catch (error) {
  getLogger().error('Admin command crashed', { err: error });
  process.exitCode = 1;
} finally {
  closeDb();
}
