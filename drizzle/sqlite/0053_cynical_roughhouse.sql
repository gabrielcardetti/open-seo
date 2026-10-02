CREATE TABLE `bing_ai_citations_daily` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`citations` integer NOT NULL,
	`cited_pages` integer,
	`imported_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_ai_cited_pages` (
	`project_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`url` text NOT NULL,
	`citations` integer NOT NULL,
	`imported_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `period_start`, `period_end`, `url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_ai_grounding_queries` (
	`project_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`query` text NOT NULL,
	`citations` integer NOT NULL,
	`imported_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `period_start`, `period_end`, `query`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_api_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`key_hint` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`site_url` text NOT NULL,
	`connected_by_user_id` text NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`next_sync_at` text,
	`last_synced_at` text,
	`last_sync_error` text,
	`daily_quota_remaining` integer,
	`monthly_quota_remaining` integer,
	`quota_checked_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bing_connections_project_idx` ON `bing_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `bing_connections_organization_idx` ON `bing_connections` (`organization_id`);--> statement-breakpoint
CREATE TABLE `bing_crawl_daily` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`date` text NOT NULL,
	`crawled_pages` integer,
	`crawl_errors` integer,
	`in_index` integer,
	`in_links` integer,
	`code_2xx` integer,
	`code_301` integer,
	`code_302` integer,
	`code_4xx` integer,
	`code_5xx` integer,
	`all_other_codes` integer,
	`blocked_by_robots_txt` integer,
	`contains_malware` integer,
	`connection_timeout` integer,
	`dns_failures` integer,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `site_url`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_crawl_issues` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`url` text NOT NULL,
	`http_code` integer,
	`issue_flags` integer NOT NULL,
	`in_links` integer,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`resolved_at` text,
	PRIMARY KEY(`project_id`, `site_url`, `url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_link_counts` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`captured_on` text NOT NULL,
	`url` text NOT NULL,
	`link_count` integer NOT NULL,
	PRIMARY KEY(`project_id`, `site_url`, `captured_on`, `url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_page_stats` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`period_date` text NOT NULL,
	`page` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`avg_click_position` real,
	`avg_impression_position` real,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `site_url`, `period_date`, `page`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_query_stats` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`period_date` text NOT NULL,
	`query` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`avg_click_position` real,
	`avg_impression_position` real,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `site_url`, `period_date`, `query`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_sitemaps` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`feed_url` text NOT NULL,
	`status` text,
	`url_count` integer,
	`last_crawled_at` text,
	`submitted_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `site_url`, `feed_url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bing_traffic_daily` (
	`project_id` text NOT NULL,
	`site_url` text NOT NULL,
	`date` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `site_url`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `indexing_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`indexnow_key` text,
	`indexnow_key_location` text,
	`indexnow_verified_at` text,
	`indexnow_last_error` text,
	`auto_submit_enabled` integer DEFAULT true NOT NULL,
	`dedupe_hours` integer DEFAULT 24 NOT NULL,
	`deploy_hook_secret_hash` text,
	`next_sitemap_check_at` text,
	`last_sitemap_check_at` text,
	`last_sitemap_error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sitemap_urls` (
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`lastmod` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`removed_at` text,
	PRIMARY KEY(`project_id`, `url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `url_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`channel` text,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`error_message` text,
	`batch_id` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `url_submissions_project_submitted_idx` ON `url_submissions` (`project_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `url_submissions_project_url_idx` ON `url_submissions` (`project_id`,`url`);