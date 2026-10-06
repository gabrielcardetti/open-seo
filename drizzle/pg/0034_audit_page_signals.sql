CREATE TABLE "audit_page_hreflang" (
	"audit_id" text NOT NULL,
	"page_id" text NOT NULL,
	"hreflang" text NOT NULL,
	"href" text NOT NULL,
	CONSTRAINT "audit_page_hreflang_page_id_hreflang_href_pk" PRIMARY KEY("page_id","hreflang","href")
);
--> statement-breakpoint
CREATE TABLE "audit_page_schema_types" (
	"audit_id" text NOT NULL,
	"page_id" text NOT NULL,
	"schema_type" text NOT NULL,
	CONSTRAINT "audit_page_schema_types_page_id_schema_type_pk" PRIMARY KEY("page_id","schema_type")
);
--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "h1_text" text;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD COLUMN "has_hsts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_page_hreflang" ADD CONSTRAINT "audit_page_hreflang_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_page_hreflang" ADD CONSTRAINT "audit_page_hreflang_page_id_audit_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."audit_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_page_schema_types" ADD CONSTRAINT "audit_page_schema_types_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_page_schema_types" ADD CONSTRAINT "audit_page_schema_types_page_id_audit_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."audit_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_page_hreflang_audit_id_idx" ON "audit_page_hreflang" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_page_schema_types_audit_id_idx" ON "audit_page_schema_types" USING btree ("audit_id");