-- geometry(Geometry, 4326) is 2D-only: a PostGIS typmod fixes the coordinate dimension,
-- so LINESTRING Z values were rejected. Use an untyped geometry column; geometry type,
-- SRID 4326 and dimension are enforced by the CHECK constraints from the init migration
-- (trail_segments_geometry_linestring, trail_segments_elevation_dims).
-- Prisma does not diff inside Unsupported(...) types, so this migration is hand-written.
ALTER TABLE "trail_segments" ALTER COLUMN "geometry" TYPE geometry;
