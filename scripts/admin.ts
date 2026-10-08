// OWNER: auth-security — replace this stub
import { NotImplementedError } from '@/lib/errors';
import { getLogger } from '@/server/logger';

// `npm run admin -- <command>`: operator tasks that have no UI (create or promote an admin, grant
// credits, list users).
async function main(_args: string[]): Promise<void> {
  throw new NotImplementedError('scripts.admin');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  getLogger().error('Admin command failed', { err: error });
  process.exitCode = 1;
});
