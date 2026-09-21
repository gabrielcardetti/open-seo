CREATE TABLE "agent_readiness_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"scan_id" text NOT NULL,
	"engine" text NOT NULL,
	"check_id" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"evidence" text,
	"fix_url" text
);
--> statement-breakpoint
CREATE TABLE "agent_readiness_configs" (
	"project_id" text PRIMARY KEY NOT NULL,
	"profile" text DEFAULT 'content' NOT NULL,
	"schedule_enabled" boolean DEFAULT false NOT NULL,
	"next_run_at" text,
	"last_skip_reason" text,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_readiness_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"origin" text NOT NULL,
	"profile" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"applicable" integer DEFAULT 0 NOT NULL,
	"cloudflare_status" text DEFAULT 'skipped' NOT NULL,
	"cloudflare_level" integer,
	"cloudflare_raw" text,
	"error_message" text,
	"started_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
ALTER TABLE "agent_readiness_checks" ADD CONSTRAINT "agent_readiness_checks_scan_id_agent_readiness_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."agent_readiness_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_readiness_configs" ADD CONSTRAINT "agent_readiness_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_readiness_scans" ADD CONSTRAINT "agent_readiness_scans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_readiness_checks_scan_idx" ON "agent_readiness_checks" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "agent_readiness_scans_project_started_idx" ON "agent_readiness_scans" USING btree ("project_id","started_at");