ALTER TABLE "answer_citations" ADD COLUMN "space_id" text;--> statement-breakpoint
ALTER TABLE "answer_citations" ADD CONSTRAINT "answer_citations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_answer_citations_space" ON "answer_citations" USING btree ("space_id");