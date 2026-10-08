import { afterEach, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createMoyasarGateway } from '@/server/billing/moyasar';
import { setGatewayOverride } from '@/server/billing/config';
import type { BillingGateway } from '@/server/billing/gateway';
import { resetMockGatewayForTests } from '@/server/billing/mock';
import { getDb, type Db } from '@/server/db';
import { orders, users, type OrderRow, type UserRow } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import {
  FAKE_API_BASE,
  FAKE_SECRET_KEY,
  FAKE_WEBHOOK_SECRET,
  fakeMoyasar,
  type FakeMoyasar,
} from './fake-moyasar';

export interface BillingTest {
  readonly db: Db;
  readonly moyasar: FakeMoyasar;
  readonly gateway: BillingGateway;
  newUser(overrides?: Partial<UserRow>): UserRow;
  order(orderId: string): OrderRow;
  balance(userId: string): number;
}

/**
 * Per-test setup for billing: a fresh in-memory database, a fake Moyasar and the REAL Moyasar
 * adapter wired to it. Everything between the services and the (fake) network is production code.
 * (Not named `use…`: ESLint would take it for a React hook.)
 */
export function billingTest(): BillingTest {
  const database = freshDb();
  const state: { moyasar: FakeMoyasar; gateway: BillingGateway } = {
    moyasar: fakeMoyasar(),
    gateway: undefined as unknown as BillingGateway,
  };

  beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    resetEnvForTests();
    resetLoggerForTests();
    state.moyasar = fakeMoyasar();
    state.gateway = createMoyasarGateway({
      secretKey: FAKE_SECRET_KEY,
      apiBase: FAKE_API_BASE,
      webhookSecret: FAKE_WEBHOOK_SECRET,
      nodeEnv: 'test',
      allowLiveInDev: false,
      fetch: state.moyasar.fetch,
    });
    setGatewayOverride(state.gateway);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetLoggerForTests();
    setGatewayOverride(null);
    resetMockGatewayForTests();
  });

  return {
    get db() {
      return database.db;
    },
    get moyasar() {
      return state.moyasar;
    },
    get gateway() {
      return state.gateway;
    },
    newUser: (overrides = {}) => createUser(getDb(), { creditBalance: 0, ...overrides }),
    order(orderId) {
      const row = getDb().select().from(orders).where(eq(orders.id, orderId)).get();
      if (!row) throw new Error(`No order ${orderId}`);
      return row;
    },
    balance(userId) {
      const row = getDb()
        .select({ balance: users.creditBalance })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      if (!row) throw new Error(`No user ${userId}`);
      return row.balance;
    },
  };
}
