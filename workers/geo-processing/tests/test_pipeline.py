"""End-to-end processing against the real PostGIS test database (schema from Prisma migrations)."""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from conftest import fixture_bytes

from trailworker import persist
from trailworker.config import WorkerConfig
from trailworker.jobs import LeaseLostError, claim_next_job, mark_failed
from trailworker.main import run_once
from trailworker.normalize import normalize
from trailworker.parsing.gpx import parse_gpx
from trailworker.processing import JobContext, process
from trailworker.profile import rebuild_from_params
from trailworker.storage import LocalStorage

pytestmark = pytest.mark.integration

SOURCE_INFO = {
    "sourceCategory": "SYNTHETIC",
    "sourceName": "RouteEditor synthetic fixture",
    "license": "CC0-1.0",
    "redistributionAllowed": True,
    "commercialUseAllowed": True,
}


@pytest.fixture
def storage_dir(tmp_path: Path) -> Path:
    return tmp_path / "storage"


@pytest.fixture
def config(db_url: str, storage_dir: Path) -> WorkerConfig:
    return WorkerConfig.from_env(
        {"DATABASE_URL": db_url, "WORKER_ID": "worker-a", "STORAGE_LOCAL_DIR": str(storage_dir)}
    )


def enqueue(
    conn: psycopg.Connection[Any],
    storage_dir: Path,
    fixture: str,
    *,
    options: dict[str, Any] | None = None,
    write_file: bool = True,
) -> str:
    data = fixture_bytes(fixture)
    user_id, file_id, job_id = (str(uuid.uuid4()) for _ in range(3))
    key = f"uploads/{user_id}/{file_id}{Path(fixture).suffix}"
    if write_file:
        target = storage_dir / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    conn.execute(
        "INSERT INTO users (id, email, updated_at) VALUES (%s, %s, now())",
        (user_id, f"{user_id}@example.test"),
    )
    conn.execute(
        """
        INSERT INTO stored_files (id, owner_user_id, storage_key, original_name, mime_type, size_bytes, sha256)
        VALUES (%s, %s, %s, %s, 'application/octet-stream', %s, %s)
        """,
        (file_id, user_id, key, fixture, len(data), hashlib.sha256(data).hexdigest()),
    )
    file_format = "GEOJSON" if fixture.endswith(".geojson") else "GPX"
    conn.execute(
        """
        INSERT INTO import_jobs (id, kind, owner_user_id, file_id, source_info, options, updated_at)
        VALUES (%s, 'TRAIL_GEOMETRY', %s, %s, %s, %s, now())
        """,
        (
            job_id,
            user_id,
            file_id,
            json.dumps(SOURCE_INFO),
            json.dumps({"format": file_format, **(options or {})}),
        ),
    )
    return job_id


def job_row(conn: psycopg.Connection[Any], job_id: str) -> dict[str, Any]:
    cursor = conn.execute(
        """
        SELECT status::text AS status, dataset_id, trail_id, errors, validation, contract_version, lease_token,
               attempts
        FROM import_jobs WHERE id = %s
        """,
        (job_id,),
    )
    row = cursor.fetchone()
    assert row is not None and cursor.description is not None
    return dict(zip([column.name for column in cursor.description], row, strict=True))


def count(conn: psycopg.Connection[Any], table: str) -> int:
    allowed = {
        "trails",
        "trail_datasets",
        "trail_segments",
        "trail_variants",
        "variant_profiles",
        "dataset_waypoints",
    }
    assert table in allowed
    row = conn.execute(f"SELECT count(*) FROM {table}").fetchone()  # noqa: S608 - table name from allowlist
    assert row is not None
    return int(row[0])


def nothing_published(conn: psycopg.Connection[Any]) -> bool:
    return all(
        count(conn, table) == 0
        for table in ("trails", "trail_datasets", "trail_segments", "trail_variants", "dataset_waypoints")
    )


def test_publishes_a_track_with_provenance_and_raw_elevation(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx")
    assert run_once(conn, config) is True

    job = job_row(conn, job_id)
    assert job["status"] == "SUCCEEDED", job["errors"]
    assert job["contract_version"] == 1
    assert job["lease_token"] is None
    assert job["validation"]["outcome"] == "SUCCEEDED"

    dataset = conn.execute(
        """
        SELECT d.visibility::text, d.is_active, d.source_category::text, d.license, d.raw_file_id = j.file_id,
               d.file_type::text, t.is_published, t.total_distance_km, t.id = j.trail_id
        FROM trail_datasets d JOIN trails t ON t.id = d.trail_id JOIN import_jobs j ON j.dataset_id = d.id
        WHERE j.id = %s
        """,
        (job_id,),
    ).fetchone()
    assert dataset is not None
    visibility, active, category, license_, raw_linked, file_type, published, total_km, trail_linked = dataset
    assert (visibility, active, category, license_, raw_linked, file_type) == (
        "PRIVATE",
        True,
        "SYNTHETIC",
        "CC0-1.0",
        True,
        "GPX",
    )
    assert published is False and trail_linked is True
    assert total_km == pytest.approx(10.0, abs=1e-6)

    segment = conn.execute(
        "SELECT ST_NDims(geometry), ST_Z(ST_PointN(geometry, 241)), point_count, has_elevation FROM trail_segments"
    ).fetchone()
    assert segment == (3, 1600.0, 401, True), "raw source elevation is stored unchanged"


def test_stored_profile_is_reproducible_from_stored_geometry(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    enqueue(conn, storage_dir, "mixed-trk-rte-wpt.gpx")
    run_once(conn, config)
    variants = conn.execute(
        """
        SELECT v.id, p.processing_params, p.distances_km, p.elevations_m, p.segment_start_indices, v.ascent_m
        FROM trail_variants v JOIN variant_profiles p ON p.variant_id = v.id
        """
    ).fetchall()
    assert len(variants) == 2
    for variant_id, params, distances, elevations, starts, ascent in variants:
        rows = conn.execute(
            """
            SELECT ST_AsGeoJSON(s.geometry, 15) FROM variant_segments vs
            JOIN trail_segments s ON s.id = vs.segment_id
            WHERE vs.variant_id = %s ORDER BY vs.sequence
            """,
            (variant_id,),
        ).fetchall()
        segments = [[tuple(position) for position in json.loads(row[0])["coordinates"]] for row in rows]
        rebuilt = rebuild_from_params(segments, params)
        assert rebuilt.distances_km == pytest.approx(distances, abs=1e-9)
        assert rebuilt.elevations_m == pytest.approx(elevations, abs=1e-9)
        assert rebuilt.segment_start_indices == starts
        assert rebuilt.ascent_m == pytest.approx(ascent, abs=1e-6)


def test_tracks_routes_and_waypoints_keep_their_semantics(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    enqueue(conn, storage_dir, "mixed-trk-rte-wpt.gpx")
    run_once(conn, config)
    variants = conn.execute(
        "SELECT source_kind::text, source_index, is_main, name FROM trail_variants ORDER BY source_index"
    ).fetchall()
    assert variants == [("ROUTE", 0, False, "Planned route"), ("TRACK", 1, True, "Recorded track")]
    ranges = conn.execute(
        """
        SELECT s.source_part_index, vs.start_distance_km, vs.end_distance_km
        FROM variant_segments vs JOIN trail_variants v ON v.id = vs.variant_id
        JOIN trail_segments s ON s.id = vs.segment_id
        WHERE v.source_kind = 'TRACK' ORDER BY vs.sequence
        """
    ).fetchall()
    assert [part for part, _, _ in ranges] == [0, 1]
    assert ranges[0][2] == pytest.approx(ranges[1][1]), "km is continuous even though geometry is not"
    waypoints = conn.execute(
        "SELECT name, symbol, elevation_m, ST_X(location) = longitude FROM dataset_waypoints ORDER BY sequence"
    ).fetchall()
    assert [(name, symbol) for name, symbol, _, _ in waypoints] == [
        ("Synthetic spring", "Drinking Water"),
        ("Synthetic hut", "Lodging"),
        ("Synthetic viewpoint", None),
    ]
    assert waypoints[2][2] is None
    assert all(synced for *_, synced in waypoints)


def test_failed_import_publishes_nothing_and_records_structured_errors(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    job_id = enqueue(conn, storage_dir, "track-large-gap.gpx")
    run_once(conn, config)
    job = job_row(conn, job_id)
    assert job["status"] == "FAILED"
    assert job["dataset_id"] is None and job["trail_id"] is None
    [error] = job["errors"]
    assert error["code"] == "GAP_TOO_LARGE"
    assert error["retryable"] is False
    assert error["details"]["location"]["pointIndex"] == 40
    assert job["validation"]["outcome"] == "FAILED"
    assert job["contract_version"] == 1
    assert nothing_published(conn)


def test_checksum_mismatch_is_refused(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx")
    [key] = [path for path in storage_dir.rglob("*.gpx")]
    key.write_bytes(key.read_bytes().replace(b"Basic track", b"Other track"))
    run_once(conn, config)
    job = job_row(conn, job_id)
    assert [error["code"] for error in job["errors"]] == ["CHECKSUM_MISMATCH"]
    assert nothing_published(conn)


def test_a_crash_during_persistence_leaves_no_partial_dataset(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = enqueue(conn, storage_dir, "mixed-trk-rte-wpt.gpx")

    def explode(*_: Any, **__: Any) -> None:
        raise RuntimeError("database went away after the segments were written")

    monkeypatch.setattr(persist, "mark_succeeded_in_transaction", explode)
    run_once(conn, config)
    job = job_row(conn, job_id)
    assert job["status"] == "FAILED"
    assert job["errors"] == [
        {
            "code": "INTERNAL_ERROR",
            "message": "The import failed unexpectedly.",
            "details": {},
            "retryable": True,
        }
    ]
    assert nothing_published(conn)


def test_retry_after_a_retryable_failure_creates_exactly_one_dataset(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx", write_file=False)
    run_once(conn, config)
    first = job_row(conn, job_id)
    assert [(e["code"], e["retryable"]) for e in first["errors"]] == [("FILE_NOT_FOUND", True)]

    # The file becomes available; the web app's retry puts the job back in the queue.
    key = conn.execute("SELECT storage_key FROM stored_files").fetchone()
    assert key is not None
    target = storage_dir / key[0]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(fixture_bytes("track-basic.gpx"))
    conn.execute(
        "UPDATE import_jobs SET status = 'PENDING', attempts = 0, updated_at = now() WHERE id = %s", (job_id,)
    )

    assert run_once(conn, config) is True
    assert job_row(conn, job_id)["status"] == "SUCCEEDED"
    assert run_once(conn, config) is False, "a finished job is never processed again"
    assert count(conn, "trail_datasets") == 1
    assert count(conn, "trails") == 1


def test_a_stale_worker_cannot_publish_after_the_job_is_reclaimed(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path, db_url: str
) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx")
    storage = LocalStorage(storage_dir)

    stale = claim_next_job(conn, "worker-a", max_attempts=3, lease_s=60)
    assert stale is not None
    # Worker A stalls past its lease; worker B reclaims the job with a new token.
    conn.execute(
        "UPDATE import_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = %s", (job_id,)
    )
    with psycopg.connect(db_url, autocommit=True) as other:
        fresh = claim_next_job(other, "worker-b", max_attempts=3, lease_s=60)
        assert fresh is not None and fresh.id == job_id and fresh.lease_token != stale.lease_token

        with pytest.raises(LeaseLostError):
            process(stale, JobContext(conn=conn, storage=storage, config=config))
        # The publish transaction checks ownership itself, independent of lease renewal.
        normalized = normalize(parse_gpx(fixture_bytes("track-basic.gpx")))
        with pytest.raises(LeaseLostError):
            persist.publish(
                conn,
                stale,
                file_type="GPX",
                normalized=normalized,
                source=persist.SourceInfo.from_json(SOURCE_INFO),
                trail_name="stale",
            )
        assert mark_failed(conn, stale, []) is False, "nor can it record a failure"
        assert nothing_published(conn)

        process(fresh, JobContext(conn=other, storage=storage, config=config))

    job = job_row(conn, job_id)
    assert job["status"] == "SUCCEEDED"
    assert count(conn, "trail_datasets") == 1


def test_an_expired_lease_blocks_publishing_even_before_reclaim(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx")
    job = claim_next_job(conn, "worker-a", max_attempts=3, lease_s=60)
    assert job is not None
    conn.execute(
        "UPDATE import_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = %s", (job_id,)
    )
    with pytest.raises(LeaseLostError):
        process(job, JobContext(conn=conn, storage=LocalStorage(storage_dir), config=config))
    assert nothing_published(conn)
    assert job_row(conn, job_id)["status"] == "PROCESSING"


def test_jobs_whose_last_lease_expired_are_failed(conn: psycopg.Connection[Any], storage_dir: Path) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx")
    claim_next_job(conn, "worker-a", max_attempts=1, lease_s=60)
    conn.execute(
        "UPDATE import_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = %s", (job_id,)
    )
    assert claim_next_job(conn, "worker-b", max_attempts=1) is None
    job = job_row(conn, job_id)
    assert job["status"] == "FAILED"
    assert [(e["code"], e["retryable"]) for e in job["errors"]] == [("LEASE_EXPIRED", True)]


def test_one_job_can_never_reference_two_datasets_or_share_one(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    first = enqueue(conn, storage_dir, "track-basic.gpx")
    second = enqueue(conn, storage_dir, "track-no-elevation.gpx")
    run_once(conn, config)
    dataset_id = job_row(conn, first)["dataset_id"]
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute("UPDATE import_jobs SET dataset_id = %s WHERE id = %s", (dataset_id, second))


def test_processing_requires_a_lease(conn: psycopg.Connection[Any], storage_dir: Path) -> None:
    job_id = enqueue(conn, storage_dir, "track-basic.gpx")
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("UPDATE import_jobs SET status = 'PROCESSING' WHERE id = %s", (job_id,))


def test_geojson_reprojection_is_published_in_wgs84(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage_dir: Path
) -> None:
    job_id = enqueue(conn, storage_dir, "line-epsg2056.geojson")
    run_once(conn, config)
    job = job_row(conn, job_id)
    assert job["status"] == "SUCCEEDED", job["errors"]
    assert job["validation"]["source"]["crs"]["source"] == "EPSG:2056"
    row = conn.execute(
        "SELECT ST_SRID(geometry), ST_X(ST_StartPoint(geometry)), ST_Y(ST_StartPoint(geometry)) FROM trail_segments"
    ).fetchone()
    assert row is not None
    assert row[0] == 4326
    assert row[1] == pytest.approx(7.45, abs=1e-7) and row[2] == pytest.approx(46.95, abs=1e-7)
    kind = conn.execute(
        "SELECT source_kind::text, file_type::text FROM trail_variants, trail_datasets"
    ).fetchone()
    assert kind == ("LINE", "GEOJSON")
