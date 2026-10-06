CREATE TABLE `url_inspection_changes` (
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`inspected_at` text NOT NULL,
	`coverage_state` text,
	`google_canonical` text,
	`indexed` integer NOT NULL,
	`previous_indexed` integer,
	PRIMARY KEY(`project_id`, `url`, `inspected_at`),
	FOREIGN KEY (`project_id`,`url`) REFERENCES `url_inspections`(`project_id`,`url`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `url_inspection_monitors` (
	`project_id` text PRIMARY KEY NOT NULL,
	`next_run_at` text,
	`budget_day` text,
	`inspections_today` integer DEFAULT 0 NOT NULL,
	`urls_refreshed_at` text,
	`last_run_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `url_inspections` (
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`in_sitemap` integer DEFAULT false NOT NULL,
	`sitemap_url` text,
	`verdict` text,
	`coverage_state` text,
	`indexing_state` text,
	`robots_txt_state` text,
	`page_fetch_state` text,
	`last_crawl_time` text,
	`google_canonical` text,
	`user_canonical` text,
	`last_error` text,
	`first_seen_at` text NOT NULL,
	`last_inspected_at` text,
	`first_indexed_at` text,
	PRIMARY KEY(`project_id`, `url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `url_inspections_project_due_idx` ON `url_inspections` (`project_id`,`in_sitemap`,`last_inspected_at`);