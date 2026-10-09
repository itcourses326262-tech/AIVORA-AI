CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_identities_provider_valid" CHECK("auth_identities"."provider" in ('google'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_subject_uq` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `has_password` integer DEFAULT true NOT NULL;