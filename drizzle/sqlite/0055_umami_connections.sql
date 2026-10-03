CREATE TABLE `umami_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`mode` text NOT NULL,
	`base_url` text NOT NULL,
	`credential_encrypted` text NOT NULL,
	`credential_hint` text NOT NULL,
	`website_id` text,
	`website_name` text,
	`website_domain` text,
	`team_id` text,
	`connected_by_user_id` text NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `umami_connections_project_idx` ON `umami_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `umami_connections_organization_idx` ON `umami_connections` (`organization_id`);