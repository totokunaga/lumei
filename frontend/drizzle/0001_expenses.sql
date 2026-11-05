CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`amount` integer NOT NULL,
	`category_id` text NOT NULL,
	`date` text NOT NULL,
	`spent_at` integer NOT NULL,
	`is_big_purchase` integer DEFAULT false NOT NULL,
	`description` text,
	`latitude` real,
	`longitude` real
);
--> statement-breakpoint
CREATE INDEX `expenses_date` ON `expenses` (`date`);