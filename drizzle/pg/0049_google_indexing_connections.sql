CREATE TABLE "google_indexing_connections" (
	"project_id" text PRIMARY KEY NOT NULL,
	"service_account_encrypted" text NOT NULL,
	"client_email" text NOT NULL,
	"gcp_project_id" text,
	"sample_url" text,
	"status" text NOT NULL,
	"last_error" text,
	"last_checked_at" text,
	"status_changed_at" text,
	"next_check_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_indexing_connections" ADD CONSTRAINT "google_indexing_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;