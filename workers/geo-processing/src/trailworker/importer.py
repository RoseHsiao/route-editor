"""TRAIL_GEOMETRY processor: raw file → checksum → parse → validate/normalize → publish."""

from __future__ import annotations

import hashlib
from typing import Any

from .contract import CONTRACT_VERSION, MAX_FILE_BYTES, SourceFormat
from .jobs import ClaimedJob, JobError, renew_lease
from .normalize import ImportFailedError, ImportOptions, ValidationReport, normalize
from .parsing.geojson import parse_geojson
from .parsing.gpx import parse_gpx
from .parsing.types import ParsedSource, ParseFailedError
from .persist import SourceInfo, publish
from .processing import JobContext, JobFailedError, ProcessingResult


def _fail(code: str, message: str, *, retryable: bool = False, **details: Any) -> JobFailedError:
    return JobFailedError([JobError(code, message, details, retryable=retryable)])


def _errors_from_report(report: ValidationReport) -> list[JobError]:
    errors = []
    for issue in report.issues:
        if issue.severity != "error":
            continue
        details = dict(issue.details)
        if issue.location is not None:
            details["location"] = issue.location.to_json()
        errors.append(JobError(issue.code, issue.message, details))
    return errors


def detect_format(declared: Any, data: bytes) -> SourceFormat:
    if declared in ("GPX", "GEOJSON"):
        return declared  # type: ignore[no-any-return]
    head = data.lstrip(b"\xef\xbb\xbf \t\r\n")[:1]
    return "GEOJSON" if head in (b"{", b"[") else "GPX"


def parse(data: bytes, file_format: SourceFormat) -> ParsedSource:
    return parse_gpx(data) if file_format == "GPX" else parse_geojson(data)


def process_trail_geometry(job: ClaimedJob, ctx: JobContext) -> ProcessingResult:
    if job.trail_id is not None:
        raise _fail(
            "UNSUPPORTED_TARGET", "Importing a new version of an existing trail is not supported yet."
        )

    row = ctx.conn.execute(
        "SELECT storage_key, sha256, size_bytes FROM stored_files WHERE id = %s", (job.file_id,)
    ).fetchone()
    if row is None:
        raise _fail("FILE_NOT_FOUND", "The uploaded file record is missing.")
    storage_key, expected_sha256, expected_size = row

    if expected_size > MAX_FILE_BYTES:
        raise _fail("FILE_TOO_LARGE", "The file is larger than the import limit.", limitBytes=MAX_FILE_BYTES)
    data = ctx.storage.read(storage_key)
    if data is None:
        raise _fail("FILE_NOT_FOUND", "The uploaded file is not in storage.", retryable=True)
    actual_sha256 = hashlib.sha256(data).hexdigest()
    if len(data) != expected_size or actual_sha256 != expected_sha256:
        # The raw file must be exactly what was uploaded; never process a different file.
        raise _fail(
            "CHECKSUM_MISMATCH",
            "The stored file does not match the checksum recorded at upload.",
            expectedSha256=expected_sha256,
            actualSha256=actual_sha256,
        )
    if not data.strip():
        raise _fail("EMPTY_FILE", "The file is empty.")

    try:
        options = ImportOptions.from_json(job.options)
    except ValueError as error:
        raise _fail("INVALID_OPTIONS", f"Import options are invalid: {error}.") from error
    try:
        source = SourceInfo.from_json(job.source_info)
    except ValueError as error:
        raise _fail("INVALID_SOURCE_INFO", f"Source information is invalid: {error}.") from error

    file_format = detect_format(job.options.get("format"), data)
    try:
        normalized = normalize(parse(data, file_format), options)
    except ParseFailedError as failure:
        report = ValidationReport("FAILED", {"format": file_format}, {}, failure.issues, options.to_json())
        raise JobFailedError(_errors_from_report(report), report.to_json(), CONTRACT_VERSION) from failure
    except ImportFailedError as failure:
        raise JobFailedError(
            _errors_from_report(failure.report), failure.report.to_json(), CONTRACT_VERSION
        ) from failure

    renew_lease(ctx.conn, job, ctx.config.lease_s)
    trail_name = _trail_name(job.options.get("trailName"), normalized.source_name, normalized.main_line.name)
    dataset_id = publish(
        ctx.conn, job, file_type=file_format, normalized=normalized, source=source, trail_name=trail_name
    )
    return ProcessingResult(dataset_id=dataset_id, validation=normalized.report.to_json())


def _trail_name(*candidates: Any) -> str:
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()[:200]
    return "Imported route"


def evaluate(data: bytes, file_format: SourceFormat, options: ImportOptions | None = None) -> dict[str, Any]:
    """Runs parse → validate → normalize without any I/O. Used for contract examples and tests."""
    options = options or ImportOptions()
    try:
        normalized = normalize(parse(data, file_format), options)
    except ParseFailedError as failure:
        report = ValidationReport("FAILED", {"format": file_format}, {}, failure.issues, options.to_json())
        return {"outcome": "FAILED", "normalized": None, "report": report.to_json()}
    except ImportFailedError as failure:
        return {"outcome": "FAILED", "normalized": None, "report": failure.report.to_json()}
    return {"outcome": "SUCCEEDED", "normalized": normalized.to_json(), "report": normalized.report.to_json()}
