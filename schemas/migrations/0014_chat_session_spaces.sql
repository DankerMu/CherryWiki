CREATE TABLE IF NOT EXISTS "chat_session_spaces" (
  "session_id" text NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "tenant_id" text NOT NULL,
  "space_id" text NOT NULL REFERENCES "spaces"("id"),
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_session_spaces_pkey" PRIMARY KEY("session_id","space_id")
);

CREATE INDEX IF NOT EXISTS "idx_chat_session_spaces_tenant_space" ON "chat_session_spaces" ("tenant_id","space_id","session_id");
CREATE INDEX IF NOT EXISTS "idx_chat_session_spaces_position" ON "chat_session_spaces" ("session_id","position");

-- Backfill: create one membership row per existing session.
INSERT INTO "chat_session_spaces" ("session_id", "tenant_id", "space_id", "position")
SELECT "id", "tenant_id", "space_id", 0 FROM "chat_sessions"
ON CONFLICT DO NOTHING;
