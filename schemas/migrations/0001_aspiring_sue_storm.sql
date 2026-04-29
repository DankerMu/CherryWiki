CREATE TABLE "permission_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"actor_user_id" text,
	"change_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"old_permissions_json" jsonb,
	"new_permissions_json" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_tenant_id_category_key_unique" UNIQUE("tenant_id","category","key")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "permission_versions" ADD CONSTRAINT "permission_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_versions" ADD CONSTRAINT "permission_versions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_versions" ADD CONSTRAINT "permission_versions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_permission_versions_space" ON "permission_versions" USING btree ("tenant_id","space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_permission_versions_subject" ON "permission_versions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_system_settings_lookup" ON "system_settings" USING btree ("tenant_id","category","key");