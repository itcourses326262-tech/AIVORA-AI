import { authenticate, type AuthContext } from '@/server/auth';
import type { Db } from '@/server/db';
import { createSession } from '../../helpers/factories';

const URL_OF_ANY_ROUTE = 'http://localhost:3000/api/v1/auth/me';

/** What `authenticate` makes of a browser session for the user (inserted straight into the database). */
export async function authContextFor(db: Db, userId: string): Promise<AuthContext | null> {
  const session = createSession(db, userId);
  return authenticate(new Request(URL_OF_ANY_ROUTE, { headers: { cookie: session.cookie } }));
}
