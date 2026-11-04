-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "source_category" AS ENUM ('OFFICIAL', 'OPEN_DATA', 'THIRD_PARTY', 'USER_UPLOAD', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "dataset_visibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "source_file_type" AS ENUM ('GPX', 'GEOJSON', 'CSV', 'OSM_OVERPASS');

-- CreateEnum
CREATE TYPE "trail_difficulty" AS ENUM ('EASY', 'MODERATE', 'CHALLENGING', 'DIFFICULT', 'ALPINE');

-- CreateEnum
CREATE TYPE "elevation_source" AS ENUM ('SOURCE_FILE', 'DEM', 'NONE');

-- CreateEnum
CREATE TYPE "poi_type" AS ENUM ('ACCOMMODATION', 'WATER', 'FOOD', 'REST', 'TRANSPORT', 'HAZARD', 'PASS');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('UNVERIFIED', 'COMMUNITY_REPORTED', 'VERIFIED', 'OUTDATED');

-- CreateEnum
CREATE TYPE "accommodation_reliability" AS ENUM ('USER_BOOKED', 'VERIFIED_AVAILABILITY', 'VERIFIED_AVAILABILITY_UNKNOWN', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "trek_direction" AS ENUM ('FORWARD', 'REVERSE');

-- CreateEnum
CREATE TYPE "planning_mode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "trek_status" AS ENUM ('DRAFT', 'PLANNED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "fitness_level" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'EXPERIENCED', 'ATHLETIC');

-- CreateEnum
CREATE TYPE "trek_day_type" AS ENUM ('HIKING', 'REST');

-- CreateEnum
CREATE TYPE "day_planning_status" AS ENUM ('AUTO_PLANNED', 'USER_EDITED');

-- CreateEnum
CREATE TYPE "trek_stop_type" AS ENUM ('OVERNIGHT', 'WATER', 'FOOD', 'REST', 'TRANSPORT', 'PERSONAL', 'NOTE');

-- CreateEnum
CREATE TYPE "trek_stop_source" AS ENUM ('USER', 'SYSTEM_RECOMMENDATION');

-- CreateEnum
CREATE TYPE "import_kind" AS ENUM ('TRAIL_GEOMETRY', 'POI');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "export_format" AS ENUM ('GPX_FULL', 'GPX_DAY', 'PDF');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('PENDING', 'GENERATING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trails" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT,
    "country_codes" TEXT[],
    "total_distance_km" DOUBLE PRECISION,
    "total_ascent_m" DOUBLE PRECISION,
    "total_descent_m" DOUBLE PRECISION,
    "difficulty" "trail_difficulty",
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trail_datasets" (
    "id" TEXT NOT NULL,
    "trail_id" TEXT NOT NULL,
    "source_category" "source_category" NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT,
    "file_type" "source_file_type" NOT NULL,
    "license" TEXT NOT NULL,
    "attribution_text" TEXT,
    "commercial_use_allowed" BOOLEAN,
    "redistribution_allowed" BOOLEAN,
    "license_verified_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL,
    "visibility" "dataset_visibility" NOT NULL DEFAULT 'PRIVATE',
    "owner_user_id" TEXT,
    "raw_file_id" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "trail_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trail_variants" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "distance_km" DOUBLE PRECISION,
    "ascent_m" DOUBLE PRECISION,
    "descent_m" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trail_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trail_segments" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "geometry" geometry(Geometry, 4326) NOT NULL,
    "has_elevation" BOOLEAN NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "ascent_m" DOUBLE PRECISION,
    "descent_m" DOUBLE PRECISION,

    CONSTRAINT "trail_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_segments" (
    "variant_id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "start_distance_km" DOUBLE PRECISION NOT NULL,
    "end_distance_km" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "variant_segments_pkey" PRIMARY KEY ("variant_id","sequence")
);

-- CreateTable
CREATE TABLE "variant_profiles" (
    "variant_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "processor_version" TEXT NOT NULL,
    "sample_spacing_m" DOUBLE PRECISION NOT NULL,
    "distances_km" DOUBLE PRECISION[],
    "elevations_m" DOUBLE PRECISION[],
    "elevation_source" "elevation_source" NOT NULL,
    "elevation_complete" BOOLEAN NOT NULL,
    "processing_params" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_profiles_pkey" PRIMARY KEY ("variant_id")
);

-- CreateTable
CREATE TABLE "trail_pois" (
    "id" TEXT NOT NULL,
    "trail_id" TEXT NOT NULL,
    "dataset_id" TEXT,
    "source_ref" TEXT,
    "name" TEXT NOT NULL,
    "type" "poi_type" NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point, 4326),
    "elevation_m" DOUBLE PRECISION,
    "source_category" "source_category" NOT NULL,
    "verification_status" "verification_status" NOT NULL DEFAULT 'UNVERIFIED',
    "last_verified_at" TIMESTAMP(3),
    "accommodation_reliability" "accommodation_reliability",
    "season_start" TEXT,
    "season_end" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trail_pois_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poi_positions" (
    "poi_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "route_distance_km" DOUBLE PRECISION NOT NULL,
    "offset_m" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "poi_positions_pkey" PRIMARY KEY ("poi_id","variant_id")
);

-- CreateTable
CREATE TABLE "treks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trail_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "direction" "trek_direction" NOT NULL DEFAULT 'FORWARD',
    "planning_mode" "planning_mode" NOT NULL DEFAULT 'AUTO',
    "status" "trek_status" NOT NULL DEFAULT 'DRAFT',
    "fitness_level" "fitness_level" NOT NULL DEFAULT 'INTERMEDIATE',
    "target_days" INTEGER,
    "target_distance_km" DOUBLE PRECISION,
    "max_distance_km" DOUBLE PRECISION,
    "max_ascent_m" DOUBLE PRECISION,
    "max_descent_m" DOUBLE PRECISION,
    "target_moving_hours" DOUBLE PRECISION,
    "max_moving_hours" DOUBLE PRECISION,
    "recommendations_enabled" BOOLEAN NOT NULL DEFAULT true,
    "itinerary_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_days" (
    "id" TEXT NOT NULL,
    "trek_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "day_type" "trek_day_type" NOT NULL DEFAULT 'HIKING',
    "start_distance_km" DOUBLE PRECISION NOT NULL,
    "end_distance_km" DOUBLE PRECISION NOT NULL,
    "planned_distance_km" DOUBLE PRECISION NOT NULL,
    "planned_ascent_m" DOUBLE PRECISION,
    "planned_descent_m" DOUBLE PRECISION,
    "max_elevation_m" DOUBLE PRECISION,
    "estimated_moving_minutes" INTEGER,
    "planned_rest_minutes" INTEGER NOT NULL DEFAULT 0,
    "overnight_stop_id" TEXT,
    "planning_status" "day_planning_status" NOT NULL DEFAULT 'AUTO_PLANNED',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trek_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_stops" (
    "id" TEXT NOT NULL,
    "trek_id" TEXT NOT NULL,
    "poi_id" TEXT,
    "name" TEXT NOT NULL,
    "stop_type" "trek_stop_type" NOT NULL,
    "source" "trek_stop_source" NOT NULL,
    "reliability" "accommodation_reliability",
    "arrival_date" DATE,
    "route_distance_km" DOUBLE PRECISION NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trek_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "kind" "import_kind" NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'PENDING',
    "owner_user_id" TEXT,
    "trail_id" TEXT,
    "file_id" TEXT NOT NULL,
    "dataset_id" TEXT,
    "source_info" JSONB NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "validation" JSONB,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_records" (
    "id" TEXT NOT NULL,
    "trek_id" TEXT NOT NULL,
    "format" "export_format" NOT NULL,
    "day_number" INTEGER,
    "status" "export_status" NOT NULL DEFAULT 'PENDING',
    "itinerary_version" INTEGER NOT NULL,
    "input_hash" TEXT NOT NULL,
    "file_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_sha256_idx" ON "stored_files"("sha256");

-- CreateIndex
CREATE INDEX "stored_files_owner_user_id_idx" ON "stored_files"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trails_slug_key" ON "trails"("slug");

-- CreateIndex
CREATE INDEX "trails_is_published_idx" ON "trails"("is_published");

-- CreateIndex
CREATE INDEX "trails_owner_user_id_idx" ON "trails"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trail_datasets_trail_id_version_key" ON "trail_datasets"("trail_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "trail_datasets_one_active_per_trail" ON "trail_datasets"("trail_id") WHERE ("is_active" = true);

-- CreateIndex
CREATE INDEX "trail_variants_dataset_id_idx" ON "trail_variants"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "trail_variants_one_main_per_dataset" ON "trail_variants"("dataset_id") WHERE ("is_main" = true);

-- CreateIndex
CREATE INDEX "trail_segments_geometry_idx" ON "trail_segments" USING GIST ("geometry");

-- CreateIndex
CREATE UNIQUE INDEX "trail_segments_dataset_id_sequence_key" ON "trail_segments"("dataset_id", "sequence");

-- CreateIndex
CREATE INDEX "variant_segments_segment_id_idx" ON "variant_segments"("segment_id");

-- CreateIndex
CREATE INDEX "trail_pois_trail_id_type_idx" ON "trail_pois"("trail_id", "type");

-- CreateIndex
CREATE INDEX "trail_pois_location_idx" ON "trail_pois" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "trail_pois_dataset_id_source_ref_key" ON "trail_pois"("dataset_id", "source_ref");

-- CreateIndex
CREATE INDEX "poi_positions_variant_id_route_distance_km_idx" ON "poi_positions"("variant_id", "route_distance_km");

-- CreateIndex
CREATE INDEX "treks_user_id_updated_at_idx" ON "treks"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trek_days_overnight_stop_id_key" ON "trek_days"("overnight_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "trek_days_trek_id_day_number_key" ON "trek_days"("trek_id", "day_number");

-- CreateIndex
CREATE INDEX "trek_stops_trek_id_route_distance_km_idx" ON "trek_stops"("trek_id", "route_distance_km");

-- CreateIndex
CREATE INDEX "import_jobs_status_created_at_idx" ON "import_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_jobs_owner_user_id_idx" ON "import_jobs"("owner_user_id");

-- CreateIndex
CREATE INDEX "export_records_trek_id_created_at_idx" ON "export_records"("trek_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "export_records_input_hash_idx" ON "export_records"("input_hash");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trails" ADD CONSTRAINT "trails_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_datasets" ADD CONSTRAINT "trail_datasets_trail_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_datasets" ADD CONSTRAINT "trail_datasets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_datasets" ADD CONSTRAINT "trail_datasets_raw_file_id_fkey" FOREIGN KEY ("raw_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_variants" ADD CONSTRAINT "trail_variants_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "trail_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_segments" ADD CONSTRAINT "trail_segments_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "trail_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_segments" ADD CONSTRAINT "variant_segments_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "trail_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_segments" ADD CONSTRAINT "variant_segments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "trail_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_profiles" ADD CONSTRAINT "variant_profiles_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "trail_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_pois" ADD CONSTRAINT "trail_pois_trail_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trail_pois" ADD CONSTRAINT "trail_pois_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "trail_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poi_positions" ADD CONSTRAINT "poi_positions_poi_id_fkey" FOREIGN KEY ("poi_id") REFERENCES "trail_pois"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poi_positions" ADD CONSTRAINT "poi_positions_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "trail_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treks" ADD CONSTRAINT "treks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treks" ADD CONSTRAINT "treks_trail_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treks" ADD CONSTRAINT "treks_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "trail_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treks" ADD CONSTRAINT "treks_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "trail_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_days" ADD CONSTRAINT "trek_days_trek_id_fkey" FOREIGN KEY ("trek_id") REFERENCES "treks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_days" ADD CONSTRAINT "trek_days_overnight_stop_id_fkey" FOREIGN KEY ("overnight_stop_id") REFERENCES "trek_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_stops" ADD CONSTRAINT "trek_stops_trek_id_fkey" FOREIGN KEY ("trek_id") REFERENCES "treks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_stops" ADD CONSTRAINT "trek_stops_poi_id_fkey" FOREIGN KEY ("poi_id") REFERENCES "trail_pois"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "trail_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_trek_id_fkey" FOREIGN KEY ("trek_id") REFERENCES "treks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written section. Prisma cannot express CHECK constraints or triggers.
-- Prisma ignores both when diffing, so they survive future migrations.
-- Documented in docs/DATA_MODEL.md ("Database-enforced invariants").
-- ════════════════════════════════════════════════════════════════════════════

-- Files
ALTER TABLE "stored_files"
  ADD CONSTRAINT "stored_files_size_non_negative" CHECK ("size_bytes" >= 0),
  ADD CONSTRAINT "stored_files_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Datasets: a dataset can only be public if redistribution is explicitly allowed.
-- NULL (unknown) is treated as not allowed.
ALTER TABLE "trail_datasets"
  ADD CONSTRAINT "trail_datasets_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "trail_datasets_public_requires_redistribution"
    CHECK ("visibility" = 'PRIVATE' OR "redistribution_allowed" IS TRUE);

-- Segments: geometry must be a valid LINESTRING in SRID 4326. Z is present
-- exactly when has_elevation is true. Ascent/descent only exist with elevation.
ALTER TABLE "trail_segments"
  ADD CONSTRAINT "trail_segments_geometry_linestring"
    CHECK (GeometryType("geometry") = 'LINESTRING' AND ST_SRID("geometry") = 4326
           AND ST_NPoints("geometry") >= 2 AND ST_IsValid("geometry")),
  ADD CONSTRAINT "trail_segments_elevation_dims"
    CHECK ("has_elevation" = (ST_NDims("geometry") = 3)),
  ADD CONSTRAINT "trail_segments_metrics_non_negative"
    CHECK ("distance_km" >= 0 AND COALESCE("ascent_m", 0) >= 0 AND COALESCE("descent_m", 0) >= 0),
  ADD CONSTRAINT "trail_segments_elevation_metrics_need_elevation"
    CHECK ("has_elevation" OR ("ascent_m" IS NULL AND "descent_m" IS NULL));

ALTER TABLE "variant_segments"
  ADD CONSTRAINT "variant_segments_range"
    CHECK ("start_distance_km" >= 0 AND "end_distance_km" >= "start_distance_km"),
  ADD CONSTRAINT "variant_segments_sequence_non_negative" CHECK ("sequence" >= 0);

-- Profiles: elevation array is either empty (incomplete) or parallel to distances.
ALTER TABLE "variant_profiles"
  ADD CONSTRAINT "variant_profiles_spacing_positive" CHECK ("sample_spacing_m" > 0),
  ADD CONSTRAINT "variant_profiles_has_samples" CHECK (cardinality("distances_km") >= 2),
  ADD CONSTRAINT "variant_profiles_elevation_length"
    CHECK (cardinality("elevations_m") IN (0, cardinality("distances_km"))),
  ADD CONSTRAINT "variant_profiles_elevation_complete_flag"
    CHECK ("elevation_complete" = (cardinality("elevations_m") > 0)),
  ADD CONSTRAINT "variant_profiles_none_means_incomplete"
    CHECK ("elevation_source" <> 'NONE' OR NOT "elevation_complete");

-- POIs
ALTER TABLE "trail_pois"
  ADD CONSTRAINT "trail_pois_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "trail_pois_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "trail_pois_reliability_not_user_booked"
    CHECK ("accommodation_reliability" IS DISTINCT FROM 'USER_BOOKED'),
  ADD CONSTRAINT "trail_pois_reliability_only_for_accommodation"
    CHECK (("type" = 'ACCOMMODATION') = ("accommodation_reliability" IS NOT NULL)),
  ADD CONSTRAINT "trail_pois_season_format"
    CHECK (("season_start" IS NULL AND "season_end" IS NULL)
        OR ("season_start" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
            AND "season_end" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'));

-- Keep the PostGIS point in sync with latitude/longitude, which are what Prisma reads and writes.
CREATE FUNCTION "trail_pois_sync_location"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trail_pois_sync_location"
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "trail_pois"
  FOR EACH ROW EXECUTE FUNCTION "trail_pois_sync_location"();

ALTER TABLE "poi_positions"
  ADD CONSTRAINT "poi_positions_non_negative"
    CHECK ("route_distance_km" >= 0 AND "offset_m" >= 0);

-- Treks: limits, where given, must be positive.
ALTER TABLE "treks"
  ADD CONSTRAINT "treks_limits_positive" CHECK (
    COALESCE("target_days", 1) >= 1
    AND COALESCE("target_distance_km", 1) > 0 AND COALESCE("max_distance_km", 1) > 0
    AND COALESCE("max_ascent_m", 1) > 0 AND COALESCE("max_descent_m", 1) > 0
    AND COALESCE("target_moving_hours", 1) > 0 AND COALESCE("max_moving_hours", 1) > 0),
  ADD CONSTRAINT "treks_itinerary_version_positive" CHECK ("itinerary_version" >= 1);

-- Days: ranges are ordered; rest days cover no distance.
ALTER TABLE "trek_days"
  ADD CONSTRAINT "trek_days_day_number_positive" CHECK ("day_number" >= 1),
  ADD CONSTRAINT "trek_days_range"
    CHECK ("start_distance_km" >= 0 AND "end_distance_km" >= "start_distance_km"),
  ADD CONSTRAINT "trek_days_metrics_non_negative" CHECK (
    "planned_distance_km" >= 0 AND COALESCE("planned_ascent_m", 0) >= 0
    AND COALESCE("planned_descent_m", 0) >= 0 AND COALESCE("estimated_moving_minutes", 0) >= 0
    AND "planned_rest_minutes" >= 0),
  ADD CONSTRAINT "trek_days_rest_day_stationary"
    CHECK ("day_type" <> 'REST' OR ("start_distance_km" = "end_distance_km" AND "planned_distance_km" = 0));

-- Stops: accommodation reliability rules (ADR 0006).
ALTER TABLE "trek_stops"
  ADD CONSTRAINT "trek_stops_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "trek_stops_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "trek_stops_route_distance_non_negative" CHECK ("route_distance_km" >= 0),
  ADD CONSTRAINT "trek_stops_recommendation_not_booked"
    CHECK ("source" <> 'SYSTEM_RECOMMENDATION' OR "reliability" IS DISTINCT FROM 'USER_BOOKED'),
  ADD CONSTRAINT "trek_stops_reliability_only_overnight"
    CHECK (("stop_type" = 'OVERNIGHT') = ("reliability" IS NOT NULL));

-- Jobs and exports
ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_attempts_non_negative" CHECK ("attempts" >= 0);

ALTER TABLE "export_records"
  ADD CONSTRAINT "export_records_day_number_for_day_exports"
    CHECK (("format" = 'GPX_DAY') = ("day_number" IS NOT NULL)),
  ADD CONSTRAINT "export_records_itinerary_version_positive" CHECK ("itinerary_version" >= 1);
