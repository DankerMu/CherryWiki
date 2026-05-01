CREATE TABLE "source_links" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"wiki_page_pk" text NOT NULL,
	"page_version_id" text NOT NULL,
	"section_id" text,
	"source_document_id" text,
	"source_uri" text,
	"quote_hash" text,
	"evidence_type" text DEFAULT 'reference' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"wiki_page_pk" text NOT NULL,
	"page_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"content_markdown" text NOT NULL,
	"frontmatter_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"graphify_run_id" text,
	"commit_hash" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_versions_wiki_page_pk_version_no_unique" UNIQUE("wiki_page_pk","version_no")
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"page_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" text,
	"indexed_version_id" text,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"docmost_page_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_pages_tenant_id_space_id_page_id_unique" UNIQUE("tenant_id","space_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"wiki_page_pk" text NOT NULL,
	"page_version_id" text NOT NULL,
	"section_id" text NOT NULL,
	"heading" text NOT NULL,
	"level" integer DEFAULT 2 NOT NULL,
	"section_index" integer NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"content_hash" text,
	"acl_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_sections_page_version_id_section_id_unique" UNIQUE("page_version_id","section_id")
);
--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_page_version_id_wiki_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_section_id_wiki_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wiki_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_links" ADD CONSTRAINT "source_links_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_versions" ADD CONSTRAINT "wiki_page_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_versions" ADD CONSTRAINT "wiki_page_versions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_versions" ADD CONSTRAINT "wiki_page_versions_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_versions" ADD CONSTRAINT "wiki_page_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "fk_wiki_pages_current_version" FOREIGN KEY ("current_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "fk_wiki_pages_indexed_version" FOREIGN KEY ("indexed_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sections" ADD CONSTRAINT "wiki_sections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sections" ADD CONSTRAINT "wiki_sections_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sections" ADD CONSTRAINT "wiki_sections_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sections" ADD CONSTRAINT "wiki_sections_page_version_id_wiki_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_source_links_page_version" ON "source_links" USING btree ("page_version_id");--> statement-breakpoint
CREATE INDEX "idx_source_links_source_doc" ON "source_links" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_versions_status" ON "wiki_page_versions" USING btree ("tenant_id","space_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_indexed_version" ON "wiki_pages" USING btree ("indexed_version_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_pages_current_indexed" ON "wiki_pages" USING btree ("current_version_id","indexed_version_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_sections_page_version" ON "wiki_sections" USING btree ("page_version_id");