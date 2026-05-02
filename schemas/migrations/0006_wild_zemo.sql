CREATE TABLE "graph_communities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"graphify_run_id" text NOT NULL,
	"community_key" text NOT NULL,
	"label" text,
	"summary" text,
	"node_count" integer DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_communities_tenant_id_space_id_graphify_run_id_community_key_unique" UNIQUE("tenant_id","space_id","graphify_run_id","community_key")
);
--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"graphify_run_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"confidence_label" text NOT NULL,
	"raw_confidence_score" double precision,
	"effective_confidence_score" double precision,
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"evidence_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acl_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_evidence_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"edge_id" text NOT NULL,
	"page_id" text,
	"page_version_id" text,
	"section_id" text,
	"source_document_id" text,
	"quote_text" text,
	"confidence_contribution" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_node_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"node_stable_key" text NOT NULL,
	"alias" text NOT NULL,
	"source" text DEFAULT 'graphify' NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_node_aliases_tenant_id_space_id_node_stable_key_alias_unique" UNIQUE("tenant_id","space_id","node_stable_key","alias")
);
--> statement-breakpoint
CREATE TABLE "graph_node_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"from_stable_key" text NOT NULL,
	"to_stable_key" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"graphify_run_id" text NOT NULL,
	"node_key" text NOT NULL,
	"stable_key" text NOT NULL,
	"label" text NOT NULL,
	"norm_label" text,
	"type" text,
	"community_id" text,
	"wiki_page_pk" text,
	"page_version_id" text,
	"source_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acl_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_nodes_tenant_id_space_id_graphify_run_id_node_key_unique" UNIQUE("tenant_id","space_id","graphify_run_id","node_key")
);
--> statement-breakpoint
CREATE TABLE "graph_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"graphify_run_id" text NOT NULL,
	"report_markdown" text NOT NULL,
	"stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphify_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"job_id" text,
	"trigger_type" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_version" text,
	"output_version" text,
	"graphify_ref" text,
	"graph_json_uri" text,
	"wiki_output_uri" text,
	"report_uri" text,
	"graph_html_uri" text,
	"schema_version" text DEFAULT 'v1' NOT NULL,
	"stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_json" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "index_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"graphify_run_id" text,
	"wiki_repo_commit_hash" text NOT NULL,
	"embedding_model_id" text NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "page_block_metadata" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"wiki_page_pk" text NOT NULL,
	"page_version_id" text NOT NULL,
	"block_id" text NOT NULL,
	"owner" text DEFAULT 'graphify' NOT NULL,
	"content_hash" text NOT NULL,
	"graphify_run_id" text,
	"last_editor" text,
	"editable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_block_metadata_page_version_id_block_id_unique" UNIQUE("page_version_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_update_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"wiki_page_pk" text,
	"graphify_run_id" text,
	"proposal_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"diff_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "graph_communities" ADD CONSTRAINT "graph_communities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_communities" ADD CONSTRAINT "graph_communities_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_communities" ADD CONSTRAINT "graph_communities_graphify_run_id_graphify_runs_id_fk" FOREIGN KEY ("graphify_run_id") REFERENCES "public"."graphify_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_graphify_run_id_graphify_runs_id_fk" FOREIGN KEY ("graphify_run_id") REFERENCES "public"."graphify_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_node_id_graph_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_target_node_id_graph_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_edge_id_graph_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."graph_edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_page_version_id_wiki_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_section_id_wiki_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wiki_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_evidence_refs" ADD CONSTRAINT "graph_evidence_refs_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_node_aliases" ADD CONSTRAINT "graph_node_aliases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_node_aliases" ADD CONSTRAINT "graph_node_aliases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_node_merges" ADD CONSTRAINT "graph_node_merges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_node_merges" ADD CONSTRAINT "graph_node_merges_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_node_merges" ADD CONSTRAINT "graph_node_merges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_graphify_run_id_graphify_runs_id_fk" FOREIGN KEY ("graphify_run_id") REFERENCES "public"."graphify_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_page_version_id_wiki_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_reports" ADD CONSTRAINT "graph_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_reports" ADD CONSTRAINT "graph_reports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_reports" ADD CONSTRAINT "graph_reports_graphify_run_id_graphify_runs_id_fk" FOREIGN KEY ("graphify_run_id") REFERENCES "public"."graphify_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphify_runs" ADD CONSTRAINT "graphify_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphify_runs" ADD CONSTRAINT "graphify_runs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphify_runs" ADD CONSTRAINT "graphify_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphify_runs" ADD CONSTRAINT "graphify_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_snapshots" ADD CONSTRAINT "index_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_snapshots" ADD CONSTRAINT "index_snapshots_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_snapshots" ADD CONSTRAINT "index_snapshots_graphify_run_id_graphify_runs_id_fk" FOREIGN KEY ("graphify_run_id") REFERENCES "public"."graphify_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_block_metadata" ADD CONSTRAINT "page_block_metadata_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_block_metadata" ADD CONSTRAINT "page_block_metadata_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_block_metadata" ADD CONSTRAINT "page_block_metadata_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_block_metadata" ADD CONSTRAINT "page_block_metadata_page_version_id_wiki_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."wiki_page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_block_metadata" ADD CONSTRAINT "page_block_metadata_last_editor_users_id_fk" FOREIGN KEY ("last_editor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_update_proposals" ADD CONSTRAINT "wiki_update_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_update_proposals" ADD CONSTRAINT "wiki_update_proposals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_update_proposals" ADD CONSTRAINT "wiki_update_proposals_wiki_page_pk_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_pk") REFERENCES "public"."wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_update_proposals" ADD CONSTRAINT "wiki_update_proposals_graphify_run_id_graphify_runs_id_fk" FOREIGN KEY ("graphify_run_id") REFERENCES "public"."graphify_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_graph_edges_source" ON "graph_edges" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_target" ON "graph_edges" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_confidence" ON "graph_edges" USING btree ("confidence_label","effective_confidence_score");--> statement-breakpoint
CREATE INDEX "idx_graph_evidence_refs_edge" ON "graph_evidence_refs" USING btree ("edge_id");--> statement-breakpoint
CREATE INDEX "idx_graph_evidence_refs_page" ON "graph_evidence_refs" USING btree ("page_id","page_version_id");--> statement-breakpoint
CREATE INDEX "idx_graph_evidence_refs_source_doc" ON "graph_evidence_refs" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "idx_graph_node_aliases_lookup" ON "graph_node_aliases" USING btree ("tenant_id","space_id","alias");--> statement-breakpoint
CREATE INDEX "idx_graph_node_merges_from" ON "graph_node_merges" USING btree ("tenant_id","space_id","from_stable_key");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_stable_key" ON "graph_nodes" USING btree ("tenant_id","space_id","stable_key");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_label_trgm" ON "graph_nodes" USING gin ("label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_graphify_runs_job" ON "graphify_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_index_snapshots_space" ON "index_snapshots" USING btree ("tenant_id","space_id","status");--> statement-breakpoint
CREATE INDEX "idx_index_snapshots_active" ON "index_snapshots" USING btree ("space_id","activated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_page_blocks_page_version" ON "page_block_metadata" USING btree ("page_version_id");--> statement-breakpoint
CREATE INDEX "idx_page_blocks_owner" ON "page_block_metadata" USING btree ("wiki_page_pk","owner");