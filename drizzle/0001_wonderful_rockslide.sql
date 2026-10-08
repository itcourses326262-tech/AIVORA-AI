CREATE TABLE `email_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_tokens_type_valid" CHECK("email_tokens"."type" in ('verify', 'reset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_tokens_token_hash_unique` ON `email_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_tokens_user_type_idx` ON `email_tokens` (`user_id`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `signup_bonus_claims` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `email_canonical` text;--> statement-breakpoint
ALTER TABLE `users` ADD `signup_ip` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;--> statement-breakpoint
UPDATE `users` SET `email_canonical` = `email` WHERE `email_canonical` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_canonical_uq` ON `users` (`email_canonical`);--> statement-breakpoint
CREATE INDEX `users_signup_ip_idx` ON `users` (`signup_ip`,`created_at`);