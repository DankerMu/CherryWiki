CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"model_config_id" text NOT NULL,
	"embedding" vector,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"wiki_page_pk" text NOT NULL,
	"page_version_id" text NOT NULL,
	"section_id" text,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text,
	"token_count" integer,
	"index_status" text DEFAULT 'pending' NOT NULL,
	"index_snapshot_id" text,
	"index_version" text,
	"indexed_at" timestamp with time zone,
	"embedding_model_id" text,
	"injection_risk" boolean DEFAULT false NOT NULL,
	"source_chain_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acl_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_chunks_page_version_id_chunk_index_unique" UNIQUE("page_version_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_chunk_id_wiki_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."wiki_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_model_config_id_model_configs_id_fk" FOREIGN KEY ("model_config_id") REFERENCES "public"."model_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_page_version_id_wiki_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_section_id_wiki_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wiki_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_embeddings_model" ON "embeddings" USING btree ("model_config_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_chunks_space" ON "wiki_chunks" USING btree ("tenant_id","space_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_chunks_index_status" ON "wiki_chunks" USING btree ("index_status","index_snapshot_id");--> statement-breakpoint
CREATE INDEX "idx_wiki_chunks_fts" ON "wiki_chunks" USING GIN (to_tsvector('simple', content));
