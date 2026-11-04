-- Runs once, on first initialization of the local database volume.
-- Creates a separate database for integration tests.
--
-- PostGIS is deliberately NOT enabled here: the first Prisma migration runs
-- CREATE EXTENSION, so the extension is part of migration history and Prisma
-- does not report drift.

CREATE DATABASE trailplanner_test OWNER trailplanner;
