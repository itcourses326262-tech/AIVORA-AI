CREATE TABLE `upstream_spend` (
	`generation_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`cost` integer NOT NULL,
	`created_at` integer NOT NULL,
	`released_at` integer,
	CONSTRAINT "upstream_spend_provider_valid" CHECK("upstream_spend"."provider" in ('mock', 'openai', 'fal', 'replicate')),
	CONSTRAINT "upstream_spend_cost_nonnegative" CHECK("upstream_spend"."cost" >= 0)
);
--> statement-breakpoint
CREATE INDEX `upstream_spend_created_idx` ON `upstream_spend` (`created_at`);--> statement-breakpoint
-- Generations that already exist keep counting against the daily budget until they leave the window.
INSERT INTO `upstream_spend` (`generation_id`, `provider`, `cost`, `created_at`, `released_at`)
SELECT `id`, `provider`, `cost`, `created_at`, NULL FROM `generations`
WHERE `provider` <> 'mock'
	AND `status` IN ('queued', 'processing', 'succeeded')
	AND `created_at` > CAST(strftime('%s', 'now') AS integer) * 1000 - 86400000;
