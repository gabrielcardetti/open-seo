CREATE TABLE "project_sitemaps" (
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"confirmed_at" text,
	CONSTRAINT "project_sitemaps_project_id_url_pk" PRIMARY KEY("project_id","url")
);
--> statement-breakpoint
ALTER TABLE "project_sitemaps" ADD CONSTRAINT "project_sitemaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;