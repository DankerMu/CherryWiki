CREATE TABLE "bridge_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"source" varchar(20) DEFAULT 'docmost' NOT NULL,
	"space_id" varchar(64),
	"page_id" varchar(64),
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"error_json" jsonb,
	"nonce" varchar(64),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"bridge_event_id" text NOT NULL,
	"direction" varchar(10) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_bridge_event_id_bridge_events_id_fk" FOREIGN KEY ("bridge_event_id") REFERENCES "public"."bridge_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bridge_events_space_type_received" ON "bridge_events" USING btree ("space_id","event_type","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_bridge_events_pending" ON "bridge_events" USING btree ("status") WHERE "bridge_events"."status" IN ('received', 'processing');--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_event_attempt" ON "webhook_deliveries" USING btree ("bridge_event_id","attempt");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_direction_created" ON "webhook_deliveries" USING btree ("direction","created_at" DESC NULLS LAST);