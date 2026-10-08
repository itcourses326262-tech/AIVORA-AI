CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`generation_id` text,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`output_index` integer DEFAULT 0 NOT NULL,
	`storage_key` text NOT NULL,
	`thumb_key` text,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`sha256` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assets_role_valid" CHECK("assets"."role" in ('input', 'output')),
	CONSTRAINT "assets_kind_valid" CHECK("assets"."kind" in ('image', 'video')),
	CONSTRAINT "assets_bytes_nonnegative" CHECK("assets"."bytes" >= 0),
	CONSTRAINT "assets_index_nonnegative" CHECK("assets"."output_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX `assets_generation_idx` ON `assets` (`generation_id`,`output_index`);--> statement-breakpoint
CREATE INDEX `assets_user_created_idx` ON `assets` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reason` text NOT NULL,
	`generation_id` text,
	`note` text,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_ledger_delta_nonzero" CHECK("credit_ledger"."delta" <> 0),
	CONSTRAINT "credit_ledger_balance_nonnegative" CHECK("credit_ledger"."balance_after" >= 0),
	CONSTRAINT "credit_ledger_reason_valid" CHECK("credit_ledger"."reason" in ('signup_bonus', 'generation', 'refund', 'admin_grant', 'purchase', 'adjustment'))
);
--> statement-breakpoint
CREATE INDEX `credit_ledger_user_created_idx` ON `credit_ledger` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `credit_ledger_generation_idx` ON `credit_ledger` (`generation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_uq` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`kind` text NOT NULL,
	`model_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt` text NOT NULL,
	`negative_prompt` text,
	`params` text NOT NULL,
	`input_asset_id` text,
	`cost` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`provider_job_id` text,
	`provider_meta` text,
	`error_code` text,
	`error_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`worker_id` text,
	`lease_until` integer,
	`idempotency_key` text,
	`is_public` integer DEFAULT false NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`input_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "generations_status_valid" CHECK("generations"."status" in ('queued', 'processing', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "generations_tool_valid" CHECK("generations"."tool" in ('text-to-image', 'image-to-image', 'text-to-video', 'image-to-video')),
	CONSTRAINT "generations_kind_valid" CHECK("generations"."kind" in ('image', 'video')),
	CONSTRAINT "generations_provider_valid" CHECK("generations"."provider" in ('mock', 'openai', 'fal', 'replicate')),
	CONSTRAINT "generations_progress_range" CHECK("generations"."progress" between 0 and 100),
	CONSTRAINT "generations_cost_nonnegative" CHECK("generations"."cost" >= 0),
	CONSTRAINT "generations_attempts_nonnegative" CHECK("generations"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `generations_user_created_idx` ON `generations` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `generations_status_lease_idx` ON `generations` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `generations_public_created_idx` ON `generations` (`is_public`,"created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `generations_user_idempotency_uq` ON `generations` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`credit_balance` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`disabled_at` integer,
	CONSTRAINT "users_credit_balance_nonnegative" CHECK("users"."credit_balance" >= 0),
	CONSTRAINT "users_email_lowercase" CHECK("users"."email" = lower("users"."email")),
	CONSTRAINT "users_role_valid" CHECK("users"."role" in ('user', 'admin')),
	CONSTRAINT "users_locale_valid" CHECK("users"."locale" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);