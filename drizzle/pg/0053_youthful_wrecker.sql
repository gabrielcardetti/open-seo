CREATE TABLE "bing_ai_citations_daily" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"citations" integer NOT NULL,
	"cited_pages" integer,
	"imported_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_ai_citations_daily_project_id_date_pk" PRIMARY KEY("project_id","date")
);
--> statement-breakpoint
CREATE TABLE "bing_ai_cited_pages" (
	"project_id" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"url" text NOT NULL,
	"citations" integer NOT NULL,
	"imported_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_ai_cited_pages_project_id_period_start_period_end_url_pk" PRIMARY KEY("project_id","period_start","period_end","url")
);
--> statement-breakpoint
CREATE TABLE "bing_ai_grounding_queries" (
	"project_id" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"query" text NOT NULL,
	"citations" integer NOT NULL,
	"imported_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_ai_grounding_queries_project_id_period_start_period_end_query_pk" PRIMARY KEY("project_id","period_start","period_end","query")
);
--> statement-breakpoint
CREATE TABLE "bing_api_keys" (
	"user_id" text PRIMARY KEY NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"verified_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bing_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"site_url" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"next_sync_at" text,
	"last_synced_at" text,
	"last_sync_error" text,
	"daily_quota_remaining" integer,
	"monthly_quota_remaining" integer,
	"quota_checked_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bing_crawl_daily" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"date" text NOT NULL,
	"crawled_pages" integer,
	"crawl_errors" integer,
	"in_index" integer,
	"in_links" integer,
	"code_2xx" integer,
	"code_301" integer,
	"code_302" integer,
	"code_4xx" integer,
	"code_5xx" integer,
	"all_other_codes" integer,
	"blocked_by_robots_txt" integer,
	"contains_malware" integer,
	"connection_timeout" integer,
	"dns_failures" integer,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_crawl_daily_project_id_site_url_date_pk" PRIMARY KEY("project_id","site_url","date")
);
--> statement-breakpoint
CREATE TABLE "bing_crawl_issues" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"url" text NOT NULL,
	"http_code" integer,
	"issue_flags" integer NOT NULL,
	"in_links" integer,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"resolved_at" text,
	CONSTRAINT "bing_crawl_issues_project_id_site_url_url_pk" PRIMARY KEY("project_id","site_url","url")
);
--> statement-breakpoint
CREATE TABLE "bing_link_counts" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"captured_on" text NOT NULL,
	"url" text NOT NULL,
	"link_count" integer NOT NULL,
	CONSTRAINT "bing_link_counts_project_id_site_url_captured_on_url_pk" PRIMARY KEY("project_id","site_url","captured_on","url")
);
--> statement-breakpoint
CREATE TABLE "bing_page_stats" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"period_date" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"avg_click_position" real,
	"avg_impression_position" real,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_page_stats_project_id_site_url_period_date_page_pk" PRIMARY KEY("project_id","site_url","period_date","page")
);
--> statement-breakpoint
CREATE TABLE "bing_query_stats" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"period_date" text NOT NULL,
	"query" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"avg_click_position" real,
	"avg_impression_position" real,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_query_stats_project_id_site_url_period_date_query_pk" PRIMARY KEY("project_id","site_url","period_date","query")
);
--> statement-breakpoint
CREATE TABLE "bing_sitemaps" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"feed_url" text NOT NULL,
	"status" text,
	"url_count" integer,
	"last_crawled_at" text,
	"submitted_at" text,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	CONSTRAINT "bing_sitemaps_project_id_site_url_feed_url_pk" PRIMARY KEY("project_id","site_url","feed_url")
);
--> statement-breakpoint
CREATE TABLE "bing_traffic_daily" (
	"project_id" text NOT NULL,
	"site_url" text NOT NULL,
	"date" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "bing_traffic_daily_project_id_site_url_date_pk" PRIMARY KEY("project_id","site_url","date")
);
--> statement-breakpoint
CREATE TABLE "indexing_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"indexnow_key" text,
	"indexnow_key_location" text,
	"indexnow_verified_at" text,
	"indexnow_last_error" text,
	"auto_submit_enabled" boolean DEFAULT true NOT NULL,
	"dedupe_hours" integer DEFAULT 24 NOT NULL,
	"deploy_hook_secret_hash" text,
	"next_sitemap_check_at" text,
	"last_sitemap_check_at" text,
	"last_sitemap_error" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sitemap_urls" (
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"lastmod" text,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"removed_at" text,
	CONSTRAINT "sitemap_urls_project_id_url_pk" PRIMARY KEY("project_id","url")
);
--> statement-breakpoint
CREATE TABLE "url_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"channel" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"error_message" text,
	"batch_id" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"submitted_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bing_ai_citations_daily" ADD CONSTRAINT "bing_ai_citations_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_ai_cited_pages" ADD CONSTRAINT "bing_ai_cited_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_ai_grounding_queries" ADD CONSTRAINT "bing_ai_grounding_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_api_keys" ADD CONSTRAINT "bing_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_connections" ADD CONSTRAINT "bing_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_connections" ADD CONSTRAINT "bing_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_crawl_daily" ADD CONSTRAINT "bing_crawl_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_crawl_issues" ADD CONSTRAINT "bing_crawl_issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_link_counts" ADD CONSTRAINT "bing_link_counts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_page_stats" ADD CONSTRAINT "bing_page_stats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_query_stats" ADD CONSTRAINT "bing_query_stats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_sitemaps" ADD CONSTRAINT "bing_sitemaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bing_traffic_daily" ADD CONSTRAINT "bing_traffic_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexing_settings" ADD CONSTRAINT "indexing_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitemap_urls" ADD CONSTRAINT "sitemap_urls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_submissions" ADD CONSTRAINT "url_submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bing_connections_project_idx" ON "bing_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "bing_connections_organization_idx" ON "bing_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "url_submissions_project_submitted_idx" ON "url_submissions" USING btree ("project_id","submitted_at");--> statement-breakpoint
CREATE INDEX "url_submissions_project_url_idx" ON "url_submissions" USING btree ("project_id","url");