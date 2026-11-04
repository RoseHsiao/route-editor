"""Publishing a normalized import: one transaction, gated on the job lease.

Everything (trail, dataset, segments, variants, profiles, waypoints and the job's
SUCCEEDED status) is written in a single transaction that first locks the job row and
verifies this worker's lease. If anything fails, nothing is visible. If the lease was
lost, nothing is written. `import_jobs.dataset_id` is unique, so one job can never
publish two datasets.
"""

from __future__ import annotations

import json
import re
import secrets
import unicodedata
import uuid
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from . import PROCESSOR_VERSION
from .contract import CONTRACT_VERSION, SourceFormat
from .jobs import ClaimedJob, lock_owned_job, mark_succeeded_in_transaction
from .normalize import NormalizedImport

SOURCE_CATEGORIES = ("OFFICIAL", "OPEN_DATA", "THIRD_PARTY", "USER_UPLOAD", "SYNTHETIC")


@dataclass(frozen=True)
class SourceInfo:
    """Provenance declared at upload time (ADR 0003). Tri-state permissions: None = unknown."""

    source_category: str
    source_name: str
    source_url: str | None
    license: str
    attribution_text: str | None
    commercial_use_allowed: bool | None
    redistribution_allowed: bool | None

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> SourceInfo:
        category = raw.get("sourceCategory")
        if category not in SOURCE_CATEGORIES:
            raise ValueError("sourceCategory is missing or unknown")
        name = raw.get("sourceName")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("sourceName is required")
        license_ = raw.get("license") or "UNKNOWN"
        if not isinstance(license_, str):
            raise ValueError("license must be a string")

        def optional_text(key: str) -> str | None:
            value = raw.get(key)
            if value is None:
                return None
            if not isinstance(value, str):
                raise ValueError(f"{key} must be a string")
            return value.strip() or None

        def tri_state(key: str) -> bool | None:
            value = raw.get(key)
            if value is not None and not isinstance(value, bool):
                raise ValueError(f"{key} must be true, false or null")
            return value

        return cls(
            source_category=category,
            source_name=name.strip(),
            source_url=optional_text("sourceUrl"),
            license=license_.strip(),
            attribution_text=optional_text("attributionText"),
            commercial_use_allowed=tri_state("commercialUseAllowed"),
            redistribution_allowed=tri_state("redistributionAllowed"),
        )


def _new_id() -> str:
    return str(uuid.uuid4())


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:60].strip("-") or "route"
    return f"{base}-{secrets.token_hex(4)}"


def _geometry_json(vertices: list[tuple[float, ...]]) -> str:
    return json.dumps({"type": "LineString", "coordinates": [list(vertex) for vertex in vertices]})


def publish(
    conn: psycopg.Connection[Any],
    job: ClaimedJob,
    *,
    file_type: SourceFormat,
    normalized: NormalizedImport,
    source: SourceInfo,
    trail_name: str,
) -> str:
    """Writes the import and marks the job SUCCEEDED atomically. Returns the dataset id."""
    main = normalized.main_line
    with conn.transaction():
        lock_owned_job(conn, job)

        trail_id, dataset_id = _new_id(), _new_id()
        conn.execute(
            """
            INSERT INTO trails (id, name, slug, country_codes, total_distance_km, total_ascent_m,
                                total_descent_m, is_published, owner_user_id, created_at, updated_at)
            VALUES (%s, %s, %s, ARRAY[]::text[], %s, %s, %s, false, %s, clock_timestamp(), clock_timestamp())
            """,
            (
                trail_id,
                trail_name,
                slugify(trail_name),
                main.distance_km,
                main.profile.ascent_m,
                main.profile.descent_m,
                job.owner_user_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO trail_datasets (id, trail_id, source_category, source_name, source_url, file_type,
                                        license, attribution_text, commercial_use_allowed,
                                        redistribution_allowed,
                                        version, visibility, owner_user_id, raw_file_id, is_active)
            VALUES (%s, %s, %s::source_category, %s, %s, %s::source_file_type, %s, %s, %s, %s,
                    1, 'PRIVATE', %s, %s, true)
            """,
            (
                dataset_id,
                trail_id,
                source.source_category,
                source.source_name,
                source.source_url,
                file_type,
                source.license,
                source.attribution_text,
                source.commercial_use_allowed,
                source.redistribution_allowed,
                job.owner_user_id,
                job.file_id,
            ),
        )

        sequence = 0
        for line in normalized.lines:
            variant_id = _new_id()
            conn.execute(
                """
                INSERT INTO trail_variants (id, dataset_id, name, is_main, is_active, source_kind,
                                            source_index,
                                            source_metadata, distance_km, ascent_m, descent_m, created_at)
                VALUES (%s, %s, %s, %s, true, %s::route_source_kind, %s, %s, %s, %s, %s, clock_timestamp())
                """,
                (
                    variant_id,
                    dataset_id,
                    line.name,
                    line.is_main,
                    line.source_kind,
                    line.source_index,
                    Jsonb(line.metadata),
                    line.distance_km,
                    line.profile.ascent_m,
                    line.profile.descent_m,
                ),
            )
            start_km = 0.0
            for position, segment in enumerate(line.segments):
                segment_id = _new_id()
                conn.execute(
                    """
                    INSERT INTO trail_segments (id, dataset_id, sequence, source_part_index, point_count,
                                                elevation_point_count, geometry, has_elevation, distance_km,
                                                ascent_m, descent_m)
                    VALUES (%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s, %s, %s)
                    """,
                    (
                        segment_id,
                        dataset_id,
                        sequence,
                        segment.source_part_index,
                        len(segment.vertices),
                        segment.elevation_point_count,
                        _geometry_json(segment.vertices),
                        segment.has_elevation,
                        segment.distance_km,
                        segment.ascent_m,
                        segment.descent_m,
                    ),
                )
                sequence += 1
                end_km = start_km + segment.distance_km
                conn.execute(
                    """
                    INSERT INTO variant_segments (variant_id, segment_id, sequence, reversed,
                                                  start_distance_km, end_distance_km)
                    VALUES (%s, %s, %s, false, %s, %s)
                    """,
                    (variant_id, segment_id, position, start_km, end_km),
                )
                start_km = end_km

            profile = line.profile
            conn.execute(
                """
                INSERT INTO variant_profiles (variant_id, schema_version, processor_version, sample_spacing_m,
                                              distances_km, elevations_m, elevation_source,
                                              elevation_complete,
                                              segment_start_indices, processing_params, computed_at)
                VALUES (%s, %s, %s, %s, %s::double precision[], %s::double precision[], %s::elevation_source,
                        %s, %s::integer[], %s, clock_timestamp())
                """,
                (
                    variant_id,
                    profile.schema_version,
                    PROCESSOR_VERSION,
                    profile.sample_spacing_m,
                    profile.distances_km,
                    profile.elevations_m,
                    profile.elevation_source,
                    profile.elevation_complete,
                    profile.segment_start_indices,
                    Jsonb(profile.params),
                ),
            )

        for sequence, waypoint in enumerate(normalized.waypoints):
            conn.execute(
                """
                INSERT INTO dataset_waypoints (id, dataset_id, sequence, name, description, comment, symbol,
                                               source_type, latitude, longitude, elevation_m, source_metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    _new_id(),
                    dataset_id,
                    sequence,
                    waypoint.name,
                    waypoint.description,
                    waypoint.comment,
                    waypoint.symbol,
                    waypoint.source_type,
                    waypoint.lat,
                    waypoint.lon,
                    waypoint.ele,
                    Jsonb(waypoint.metadata),
                ),
            )

        mark_succeeded_in_transaction(conn, job, dataset_id, normalized.report.to_json(), CONTRACT_VERSION)
    return dataset_id
