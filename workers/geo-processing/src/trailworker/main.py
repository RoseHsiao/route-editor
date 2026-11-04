"""Worker entry point: `python -m trailworker` (loop) or `python -m trailworker --once`."""

from __future__ import annotations

import argparse
import logging
import signal
import threading
from typing import Any

import psycopg

from . import PROCESSOR_VERSION
from .config import WorkerConfig
from .jobs import JobError, LeaseLostError, claim_next_job, mark_failed
from .processing import JobContext, JobFailedError, process
from .storage import StorageReader, create_storage

log = logging.getLogger("trailworker")


def run_once(
    conn: psycopg.Connection[Any], config: WorkerConfig, storage: StorageReader | None = None
) -> bool:
    """Processes at most one job. Returns True if a job was claimed."""
    job = claim_next_job(conn, config.worker_id, config.max_attempts, config.lease_s)
    if job is None:
        return False

    log.info("claimed job %s (%s, attempt %d)", job.id, job.kind, job.attempts)
    ctx = JobContext(conn=conn, storage=storage or create_storage(config), config=config)
    try:
        process(job, ctx)
    except LeaseLostError:
        # Another worker owns the job now. Nothing was written, and nothing may be.
        log.warning("job %s: lease lost; result discarded", job.id)
    except JobFailedError as failure:
        if mark_failed(conn, job, failure.errors, failure.validation, failure.contract_version):
            log.info("job %s failed: %s", job.id, failure)
        else:
            log.warning("job %s: lease lost before the failure could be recorded", job.id)
    except Exception:
        # Unexpected errors are recorded without internals; details go to the worker log only.
        log.exception("job %s crashed", job.id)
        mark_failed(
            conn, job, [JobError("INTERNAL_ERROR", "The import failed unexpectedly.", retryable=True)]
        )
    else:
        log.info("job %s succeeded", job.id)
    return True


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="trailworker", description=__doc__)
    parser.add_argument("--once", action="store_true", help="process at most one job, then exit")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = WorkerConfig.from_env()
    log.info("starting %s as %s", PROCESSOR_VERSION, config.worker_id)
    storage = create_storage(config)

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    with psycopg.connect(config.database_url, autocommit=True) as conn:
        if args.once:
            run_once(conn, config, storage)
            return
        while not stop.is_set():
            if not run_once(conn, config, storage):
                stop.wait(config.poll_interval_s)
    log.info("stopped")
