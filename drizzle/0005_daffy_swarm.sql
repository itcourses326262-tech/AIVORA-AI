CREATE TABLE `email_events` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	CONSTRAINT "email_events_kind_valid" CHECK("email_events"."kind" in ('payment_receipt', 'renewal_link', 'payment_overdue', 'subscription_expired', 'refund_notice', 'subscription_canceled', 'subscription_resumed'))
);
--> statement-breakpoint
CREATE INDEX `email_events_unsent_idx` ON `email_events` (`created_at`) WHERE "email_events"."sent_at" is null;--> statement-breakpoint
CREATE INDEX `email_events_subject_idx` ON `email_events` (`subject`,`kind`);