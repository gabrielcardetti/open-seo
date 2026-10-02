CREATE TABLE `project_sitemaps` (
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`confirmed_at` text,
	PRIMARY KEY(`project_id`, `url`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
