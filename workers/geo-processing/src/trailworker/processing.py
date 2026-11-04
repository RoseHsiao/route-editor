"""Dispatch of claimed jobs to processors.

Milestone 1 ships the queue and failure path only. Processors for TRAIL_GEOMETRY
(GPX/GeoJSON) and POI (CSV) imports are implemented in Milestones 2 and 3.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .jobs import ClaimedJob, JobError


@dataclass(frozen=True)
class ProcessingResult:
    dataset_id: str
    validation: dict[str, Any]


class JobFailedError(Exception):
    def __init__(self, errors: list[JobError], validation: dict[str, Any] | None = None) -> None:
        super().__init__("; ".join(error.message for error in errors))
        self.errors = errors
        self.validation = validation


Processor = Callable[[ClaimedJob], ProcessingResult]

PROCESSORS: dict[str, Processor] = {}


def process(job: ClaimedJob) -> ProcessingResult:
    processor = PROCESSORS.get(job.kind)
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
    return processor(job)
