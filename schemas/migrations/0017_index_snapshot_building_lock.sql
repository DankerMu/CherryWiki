-- Preflight cleanup for idx_index_snapshots_one_building_per_space:
-- if multiple building snapshots exist for the same tenant/space, keep the newest
-- building row and mark older duplicates failed so the partial unique index can apply.
UPDATE "index_snapshots"
SET "status" = 'failed'
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "tenant_id", "space_id"
        ORDER BY "created_at" DESC, "id" DESC
      ) AS "building_rank"
    FROM "index_snapshots"
    WHERE "status" = 'building'
  ) AS "ranked_building_snapshots"
  WHERE "building_rank" > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX "idx_index_snapshots_one_building_per_space" ON "index_snapshots" USING btree ("tenant_id","space_id") WHERE "index_snapshots"."status" = 'building';

-- Rollback notes:
--   DROP INDEX IF EXISTS "idx_index_snapshots_one_building_per_space";
-- The duplicate cleanup is intentionally not reversed automatically. Rows moved from
-- building to failed were non-terminal duplicates; restoring them would recreate the
-- race-prone state and could block later reindex jobs.
