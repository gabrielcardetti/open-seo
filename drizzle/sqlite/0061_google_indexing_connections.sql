CREATE TABLE `google_indexing_connections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`service_account_encrypted` text NOT NULL,
	`client_email` text NOT NULL,
	`gcp_project_id` text,
	`sample_url` text,
	`status` text NOT NULL,
	`last_error` text,
	`last_checked_at` text,
	`status_changed_at` text,
	`next_check_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
