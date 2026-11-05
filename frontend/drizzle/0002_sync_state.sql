CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `fixed_expenses` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `incomes` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `periods` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `saving_targets` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `sync_error` text;