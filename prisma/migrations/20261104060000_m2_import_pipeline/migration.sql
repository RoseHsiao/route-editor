-- M2: GPX/GeoJSON import pipeline. Track/route/line semantics, source segment
-- boundaries, standalone waypoints, and lease tokens for safe job ownership.
-- CreateEnum
CREATE TYPE "route_source_kind" AS ENUM ('TRACK', 'ROUTE', 'LINE');

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "contract_version" INTEGER,
ADD COLUMN     "lease_expires_at" TIMESTAMP(3),
ADD COLUMN     "lease_token" TEXT;

-- AlterTable
ALTER TABLE "trail_segments" ADD COLUMN     "elevation_point_count" INTEGER NOT NULL,
ADD COLUMN     "point_count" INTEGER NOT NULL,
ADD COLUMN     "source_part_index" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "trail_variants" ADD COLUMN     "source_index" INTEGER NOT NULL,
ADD COLUMN     "source_kind" "route_source_kind" NOT NULL,
ADD COLUMN     "source_metadata" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "variant_profiles" ADD COLUMN     "segment_start_indices" INTEGER[];

-- CreateTable
CREATE TABLE "dataset_waypoints" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "comment" TEXT,
    "symbol" TEXT,
    "source_type" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation_m" DOUBLE PRECISION,
    "location" geometry(Point, 4326),
    "source_metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "dataset_waypoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dataset_waypoints_location_idx" ON "dataset_waypoints" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_waypoints_dataset_id_sequence_key" ON "dataset_waypoints"("dataset_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_dataset_id_key" ON "import_jobs"("dataset_id");

-- AddForeignKey
ALTER TABLE "dataset_waypoints" ADD CONSTRAINT "dataset_waypoints_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "trail_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written section. Prisma cannot express CHECK constraints or triggers.
-- Documented in docs/DATA_MODEL.md ("Database-enforced invariants").
-- ════════════════════════════════════════════════════════════════════════════

-- Segments keep their source boundaries and an exact elevation tally.
ALTER TABLE "trail_segments"
  ADD CONSTRAINT "trail_segments_source_part_non_negative" CHECK ("source_part_index" >= 0),
  ADD CONSTRAINT "trail_segments_point_count_matches_geometry"
    CHECK ("point_count" = ST_NPoints("geometry")),
  ADD CONSTRAINT "trail_segments_elevation_point_count_range"
    CHECK ("elevation_point_count" BETWEEN 0 AND "point_count"),
  ADD CONSTRAINT "trail_segments_elevation_complete_iff_all_points"
    CHECK ("has_elevation" = ("elevation_point_count" = "point_count"));

ALTER TABLE "trail_variants"
  ADD CONSTRAINT "trail_variants_source_index_non_negative" CHECK ("source_index" >= 0);

-- Profiles: segment starts are listed explicitly and always begin at sample 0.
ALTER TABLE "variant_profiles"
  ALTER COLUMN "segment_start_indices" SET NOT NULL,
  ADD CONSTRAINT "variant_profiles_segment_starts"
    CHECK (cardinality("segment_start_indices") >= 1 AND "segment_start_indices"[1] = 0);

-- Waypoints: coordinate ranges; location kept in sync like trail_pois.
ALTER TABLE "dataset_waypoints"
  ADD CONSTRAINT "dataset_waypoints_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "dataset_waypoints_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "dataset_waypoints_sequence_non_negative" CHECK ("sequence" >= 0);

-- The function only reads NEW.latitude/NEW.longitude, so it serves both tables.
CREATE TRIGGER "dataset_waypoints_sync_location"
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "dataset_waypoints"
  FOR EACH ROW EXECUTE FUNCTION "trail_pois_sync_location"();

-- Jobs: a job is PROCESSING exactly when a worker holds a lease on it.
ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_lease_iff_processing"
    CHECK (("status" = 'PROCESSING') = ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
  ADD CONSTRAINT "import_jobs_succeeded_has_contract_version"
    CHECK ("status" <> 'SUCCEEDED' OR "contract_version" IS NOT NULL);
