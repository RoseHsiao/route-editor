"""Dispatch of claimed jobs to processors.

A processor either publishes its result itself (atomically, together with the job's
SUCCEEDED status; see persist.py) and returns a ProcessingResult, or raises
JobFailedError with structured errors. POI imports (CSV) arrive in Milestone 3.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psycopg

from .config import WorkerConfig
from .jobs import ClaimedJob, JobError
from .storage import StorageReader


@dataclass(frozen=True)
class ProcessingResult:
    dataset_id: str
    validation: dict[str, Any]


@dataclass(frozen=True)
class JobContext:
    conn: psycopg.Connection[Any]
    storage: StorageReader
    config: WorkerConfig


class JobFailedError(Exception):
    def __init__(
        self,
        errors: list[JobError],
        validation: dict[str, Any] | None = None,
        contract_version: int | None = None,
    ) -> None:
        super().__init__("; ".join(error.message for error in errors))
        self.errors = errors
        self.validation = validation
        self.contract_version = contract_version


Processor = Callable[[ClaimedJob, JobContext], ProcessingResult]


def _processors() -> dict[str, Processor]:
    # Imported lazily: processors depend on this module's types.
    from .importer import process_trail_geometry

    return {"TRAIL_GEOMETRY": process_trail_geometry}


def process(job: ClaimedJob, ctx: JobContext) -> ProcessingResult:
    processor = _processors().get(job.kind)
    if processor is None:
        raise JobFailedError(
            [
                JobError(
                    code="PROCESSOR_NOT_IMPLEMENTED",
                    message=f"Imports of kind {job.kind} are not supported yet.",
                    details={"kind": job.kind},
                )
            ]
        )
    return processor(job, ctx)
