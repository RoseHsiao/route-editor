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
from .jobs import JobError, claim_next_job, mark_failed, mark_succeeded
from .processing import JobFailedError, process

log = logging.getLogger("trailworker")


def run_once(conn: psycopg.Connection[Any], config: WorkerConfig) -> bool:
    """Processes at most one job. Returns True if a job was claimed."""
    job = claim_next_job(conn, config.worker_id, config.max_attempts)
    if job is None:
        return False

    log.info("claimed job %s (%s, attempt %d)", job.id, job.kind, job.attempts)
    try:
        result = process(job)
    except JobFailedError as failure:
        mark_failed(conn, job.id, failure.errors, failure.validation)
        log.info("job %s failed: %s", job.id, failure)
    except Exception:
        # Unexpected errors are recorded without internals; details go to the worker log only.
        log.exception("job %s crashed", job.id)
        mark_failed(conn, job.id, [JobError("INTERNAL_ERROR", "The import failed unexpectedly.")])
    else:
        mark_succeeded(conn, job.id, result.dataset_id, result.validation)
        log.info("job %s succeeded", job.id)
    return True


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="trailworker", description=__doc__)
    parser.add_argument("--once", action="store_true", help="process at most one job, then exit")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = WorkerConfig.from_env()
    log.info("starting %s as %s", PROCESSOR_VERSION, config.worker_id)

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    with psycopg.connect(config.database_url, autocommit=True) as conn:
        if args.once:
            run_once(conn, config)
            return
        while not stop.is_set():
            if not run_once(conn, config):
                stop.wait(config.poll_interval_s)
    log.info("stopped")
