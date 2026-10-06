CREATE TABLE `audit_page_hreflang` (
	`audit_id` text NOT NULL,
	`page_id` text NOT NULL,
	`hreflang` text NOT NULL,
	`href` text NOT NULL,
	PRIMARY KEY(`page_id`, `hreflang`, `href`),
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `audit_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_page_hreflang_audit_id_idx` ON `audit_page_hreflang` (`audit_id`);--> statement-breakpoint
CREATE TABLE `audit_page_schema_types` (
	`audit_id` text NOT NULL,
	`page_id` text NOT NULL,
	`schema_type` text NOT NULL,
	PRIMARY KEY(`page_id`, `schema_type`),
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `audit_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_page_schema_types_audit_id_idx` ON `audit_page_schema_types` (`audit_id`);--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `h1_text` text;--> statement-breakpoint
ALTER TABLE `audit_pages` ADD `has_hsts` integer DEFAULT false NOT NULL;