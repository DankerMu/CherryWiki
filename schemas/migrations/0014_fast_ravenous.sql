CREATE TABLE "chat_session_spaces" (
	"session_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_session_spaces_session_id_space_id_pk" PRIMARY KEY("session_id","space_id")
);
--> statement-breakpoint
ALTER TABLE "chat_session_spaces" ADD CONSTRAINT "chat_session_spaces_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_spaces" ADD CONSTRAINT "chat_session_spaces_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_session_spaces_tenant_space" ON "chat_session_spaces" USING btree ("tenant_id","space_id","session_id");--> statement-breakpoint
CREATE INDEX "idx_chat_session_spaces_position" ON "chat_session_spaces" USING btree ("session_id","position");--> statement-breakpoint
INSERT INTO "chat_session_spaces" ("session_id", "tenant_id", "space_id", "position")
SELECT "id", "tenant_id", "space_id", 0 FROM "chat_sessions"
ON CONFLICT DO NOTHING;
