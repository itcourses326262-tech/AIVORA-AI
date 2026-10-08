'use client';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { MessageKey } from '@/lib/i18n';
import type { OrderStatus } from '@/lib/billing/types';
import { useI18n } from '@/lib/i18n/client';
import type { PlanPhase } from './subscription-model';

const ORDER_VARIANT: Record<OrderStatus, BadgeVariant> = {
  pending: 'info',
  paid: 'success',
  failed: 'danger',
  canceled: 'neutral',
  refunded: 'outline',
  needs_review: 'warning',
};

const ORDER_LABEL = {
  pending: 'billing.account.orders.status.pending',
  paid: 'billing.account.orders.status.paid',
  failed: 'billing.account.orders.status.failed',
  canceled: 'billing.account.orders.status.canceled',
  refunded: 'billing.account.orders.status.refunded',
  needs_review: 'billing.account.orders.status.needs_review',
} as const satisfies Record<OrderStatus, MessageKey>;

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return (
    <Badge variant={ORDER_VARIANT[status]} dot>
      {t(ORDER_LABEL[status])}
    </Badge>
  );
}

const PLAN_VARIANT: Record<Exclude<PlanPhase, 'none'>, BadgeVariant> = {
  active: 'success',
  canceling: 'warning',
  past_due: 'warning',
  canceled: 'neutral',
  expired: 'neutral',
  incomplete: 'info',
};

const PLAN_LABEL = {
  active: 'billing.account.plan.status.active',
  canceling: 'billing.account.plan.status.canceling',
  past_due: 'billing.account.plan.status.past_due',
  canceled: 'billing.account.plan.status.canceled',
  expired: 'billing.account.plan.status.expired',
  incomplete: 'billing.account.plan.status.incomplete',
} as const satisfies Record<Exclude<PlanPhase, 'none'>, MessageKey>;

export function PlanStatusBadge({ phase }: { phase: Exclude<PlanPhase, 'none'> }) {
  const { t } = useI18n();
  return (
    <Badge variant={PLAN_VARIANT[phase]} dot>
      {t(PLAN_LABEL[phase])}
    </Badge>
  );
}
