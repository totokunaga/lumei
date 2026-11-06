CREATE TABLE `extra_incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`sync_error` text,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`received_at` integer NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE INDEX `extra_incomes_date` ON `extra_incomes` (`date`);