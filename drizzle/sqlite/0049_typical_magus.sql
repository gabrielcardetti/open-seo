CREATE TABLE `agent_readiness_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`engine` text NOT NULL,
	`check_id` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`evidence` text,
	`fix_url` text,
	FOREIGN KEY (`scan_id`) REFERENCES `agent_readiness_scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_readiness_checks_scan_idx` ON `agent_readiness_checks` (`scan_id`);--> statement-breakpoint
CREATE TABLE `agent_readiness_configs` (
	`project_id` text PRIMARY KEY NOT NULL,
	`profile` text DEFAULT 'content' NOT NULL,
	`schedule_enabled` integer DEFAULT false NOT NULL,
	`next_run_at` text,
	`last_skip_reason` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_readiness_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`origin` text NOT NULL,
	`profile` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`applicable` integer DEFAULT 0 NOT NULL,
	`cloudflare_status` text DEFAULT 'skipped' NOT NULL,
	`cloudflare_level` integer,
	`cloudflare_raw` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_readiness_scans_project_started_idx` ON `agent_readiness_scans` (`project_id`,`started_at`);