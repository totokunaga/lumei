CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`position` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `fixed_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`period_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`period_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `periods` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saving_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`period_id` text NOT NULL,
	`amount` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`pending` integer DEFAULT true NOT NULL,
	`local_rev` integer DEFAULT 1 NOT NULL,
	`region` text NOT NULL,
	`currency` text NOT NULL,
	`period_start_day` integer NOT NULL,
	`big_purchase_spread` text NOT NULL,
	`setup_completed_at` integer NOT NULL
);
