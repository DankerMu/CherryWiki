CREATE TABLE "agent_sessions" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'claude' NOT NULL,
	"provider_session_id" text,
	"work_dir" text NOT NULL,
	"agent_home" text NOT NULL,
	"status" text NOT NULL,
	"options_hash" text,
	"owned_by_instance" text,
	"last_activity_at" timestamp with time zone NOT NULL,
	"process_started_at" timestamp with time zone,
	"process_stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_conversation_id_chat_sessions_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_status" ON "agent_sessions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_instance" ON "agent_sessions" USING btree ("owned_by_instance");
