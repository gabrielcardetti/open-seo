CREATE TABLE `audit_page_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`page_id` text,
	`page_url` text NOT NULL,
	`catalog_version` text NOT NULL,
	`page_type` text,
	`ymyl` integer DEFAULT false NOT NULL,
	`ymyl_topics_json` text,
	`ai_suspected` integer DEFAULT false NOT NULL,
	`verdict` text NOT NULL,
	`critical_fails` integer DEFAULT 0 NOT NULL,
	`high_fails` integer DEFAULT 0 NOT NULL,
	`medium_fails` integer DEFAULT 0 NOT NULL,
	`low_fails` integer DEFAULT 0 NOT NULL,
	`unknown_count` integer DEFAULT 0 NOT NULL,
	`judge` text,
	`evaluated_at` text DEFAULT (current_timestamp) NOT NULL,
	`error_message` text,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `audit_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_page_evaluations_audit_id_idx` ON `audit_page_evaluations` (`audit_id`);--> statement-breakpoint
CREATE INDEX `audit_page_evaluations_page_id_idx` ON `audit_page_evaluations` (`page_id`);--> statement-breakpoint
CREATE TABLE `audit_rule_results` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`page_url` text NOT NULL,
	`rule_id` text NOT NULL,
	`status` text NOT NULL,
	`severity` text NOT NULL,
	`score` integer,
	`confidence` real,
	`evidence` text,
	`reason` text,
	`remediation` text,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluation_id`) REFERENCES `audit_page_evaluations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_rule_results_audit_rule_idx` ON `audit_rule_results` (`audit_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `audit_rule_results_evaluation_id_idx` ON `audit_rule_results` (`evaluation_id`);