CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`gateway` text NOT NULL,
	`event_key` text NOT NULL,
	`order_id` text,
	`type` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "billing_events_gateway_valid" CHECK("billing_events"."gateway" in ('mock', 'moyasar'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_events_event_key_uq` ON `billing_events` (`event_key`);--> statement-breakpoint
CREATE INDEX `billing_events_order_idx` ON `billing_events` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`amount_halalas` integer NOT NULL,
	`currency` text NOT NULL,
	`vat_halalas` integer NOT NULL,
	`credits` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`gateway` text NOT NULL,
	`gateway_invoice_id` text,
	`gateway_payment_id` text,
	`checkout_url` text,
	`subscription_id` text,
	`idempotency_key` text,
	`expires_at` integer,
	`period_start` integer,
	`period_end` integer,
	`refunded_halalas` integer DEFAULT 0 NOT NULL,
	`clawed_back_credits` integer DEFAULT 0 NOT NULL,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_kind_valid" CHECK("orders"."kind" in ('pack', 'subscription_initial', 'subscription_renewal')),
	CONSTRAINT "orders_status_valid" CHECK("orders"."status" in ('pending', 'paid', 'failed', 'canceled', 'refunded', 'needs_review')),
	CONSTRAINT "orders_gateway_valid" CHECK("orders"."gateway" in ('mock', 'moyasar')),
	CONSTRAINT "orders_currency_sar" CHECK("orders"."currency" = 'SAR'),
	CONSTRAINT "orders_amount_positive" CHECK("orders"."amount_halalas" > 0),
	CONSTRAINT "orders_vat_within_amount" CHECK("orders"."vat_halalas" between 0 and "orders"."amount_halalas"),
	CONSTRAINT "orders_credits_positive" CHECK("orders"."credits" > 0),
	CONSTRAINT "orders_refund_within_amount" CHECK("orders"."refunded_halalas" between 0 and "orders"."amount_halalas"),
	CONSTRAINT "orders_clawback_within_credits" CHECK("orders"."clawed_back_credits" between 0 and "orders"."credits")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_user_idempotency_uq` ON `orders` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_gateway_invoice_uq` ON `orders` (`gateway`,`gateway_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_gateway_payment_uq` ON `orders` (`gateway`,`gateway_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_one_pending_renewal_uq` ON `orders` (`subscription_id`) WHERE "orders"."kind" = 'subscription_renewal' and "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `orders_status_checked_idx` ON `orders` (`status`,`last_checked_at`);--> statement-breakpoint
CREATE INDEX `orders_subscription_idx` ON `orders` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`anchor_day` integer,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`next_charge_at` integer,
	`canceled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "subscriptions_status_valid" CHECK("subscriptions"."status" in ('incomplete', 'active', 'past_due', 'canceled', 'expired')),
	CONSTRAINT "subscriptions_anchor_day_valid" CHECK("subscriptions"."anchor_day" is null or "subscriptions"."anchor_day" between 1 and 31),
	CONSTRAINT "subscriptions_period_when_running" CHECK("subscriptions"."status" not in ('active', 'past_due') or ("subscriptions"."current_period_start" is not null and "subscriptions"."current_period_end" is not null and "subscriptions"."anchor_day" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_one_live_per_user_uq` ON `subscriptions` (`user_id`) WHERE "subscriptions"."status" in ('incomplete', 'active', 'past_due');--> statement-breakpoint
CREATE INDEX `subscriptions_due_idx` ON `subscriptions` (`status`,`next_charge_at`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_created_idx` ON `subscriptions` (`user_id`,"created_at" desc);