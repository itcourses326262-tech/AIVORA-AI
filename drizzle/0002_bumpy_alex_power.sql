ALTER TABLE `generations` ADD `submit_started_at` integer;--> statement-breakpoint
CREATE INDEX `generations_created_idx` ON `generations` (`created_at`);