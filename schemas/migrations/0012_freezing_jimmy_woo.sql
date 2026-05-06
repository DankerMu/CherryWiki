CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text DEFAULT '' NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "feedback_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"message_id" text,
	"space_id" text,
	"feedback_type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"description" text,
	"server_url" text NOT NULL,
	"transport" text DEFAULT 'sse' NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"policy_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_registry_tenant_id_tool_name_unique" UNIQUE("tenant_id","tool_name")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_registry" ADD CONSTRAINT "mcp_tool_registry_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_registry" ADD CONSTRAINT "mcp_tool_registry_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_tokens_user" ON "api_tokens" USING btree ("tenant_id","user_id") WHERE "api_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_mcp_tool_registry_tenant" ON "mcp_tool_registry" USING btree ("tenant_id","status");
