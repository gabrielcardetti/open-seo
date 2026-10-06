CREATE TABLE `upstream_breakers` (
	`upstream` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'closed' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`opened_at` text,
	`next_probe_at` text,
	`last_error` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
