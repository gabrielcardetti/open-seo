CREATE TABLE "audit_page_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"page_id" text,
	"page_url" text NOT NULL,
	"catalog_version" text NOT NULL,
	"page_type" text,
	"ymyl" boolean DEFAULT false NOT NULL,
	"ymyl_topics_json" text,
	"ai_suspected" boolean DEFAULT false NOT NULL,
	"verdict" text NOT NULL,
	"critical_fails" integer DEFAULT 0 NOT NULL,
	"high_fails" integer DEFAULT 0 NOT NULL,
	"medium_fails" integer DEFAULT 0 NOT NULL,
	"low_fails" integer DEFAULT 0 NOT NULL,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"judge" text,
	"evaluated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "audit_rule_results" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"evaluation_id" text NOT NULL,
	"page_url" text NOT NULL,
	"rule_id" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"score" integer,
	"confidence" real,
	"evidence" text,
	"reason" text,
	"remediation" text
);
--> statement-breakpoint
ALTER TABLE "audit_page_evaluations" ADD CONSTRAINT "audit_page_evaluations_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_page_evaluations" ADD CONSTRAINT "audit_page_evaluations_page_id_audit_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."audit_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_rule_results" ADD CONSTRAINT "audit_rule_results_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_rule_results" ADD CONSTRAINT "audit_rule_results_evaluation_id_audit_page_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."audit_page_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_page_evaluations_audit_id_idx" ON "audit_page_evaluations" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_page_evaluations_page_id_idx" ON "audit_page_evaluations" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "audit_rule_results_audit_rule_idx" ON "audit_rule_results" USING btree ("audit_id","rule_id");--> statement-breakpoint
CREATE INDEX "audit_rule_results_evaluation_id_idx" ON "audit_rule_results" USING btree ("evaluation_id");