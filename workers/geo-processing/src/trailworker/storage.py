"""Read access to object storage. Key rules mirror lib/storage/keys.ts."""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from .config import S3Config, WorkerConfig

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_MAX_KEY_LENGTH = 512


class InvalidStorageKeyError(ValueError):
    pass


def assert_valid_storage_key(key: str) -> None:
    if not 0 < len(key) <= _MAX_KEY_LENGTH:
        raise InvalidStorageKeyError(f"length must be 1 to {_MAX_KEY_LENGTH}")
    for segment in key.split("/"):
        if segment in (".", "..") or not _SEGMENT.fullmatch(segment):
            raise InvalidStorageKeyError(f"segment {segment!r} is not allowed")


class LocalStorage:
    """Filesystem storage for development, sharing a root with the web app."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root).resolve()

    def _resolve(self, key: str) -> Path:
        assert_valid_storage_key(key)
        target = (self._root / key).resolve()
        if not target.is_relative_to(self._root) or target == self._root:
            raise InvalidStorageKeyError("resolves outside the storage root")
        return target

    def read(self, key: str) -> bytes | None:
        try:
            return self._resolve(key).read_bytes()
        except FileNotFoundError:
            return None


class StorageReader(Protocol):
    def read(self, key: str) -> bytes | None: ...


class S3Storage:
    """Any S3-compatible service. Read-only: the worker never writes raw uploads."""

    def __init__(self, config: S3Config, client: S3Client | None = None) -> None:
        self._bucket = config.bucket
        self._client: S3Client = client or boto3.client(
            "s3",
            region_name=config.region or "auto",
            endpoint_url=config.endpoint,
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            config=BotoConfig(s3={"addressing_style": "path" if config.force_path_style else "auto"}),
        )

    def read(self, key: str) -> bytes | None:
        assert_valid_storage_key(key)
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
                return None
            raise
        return response["Body"].read()


def create_storage(config: WorkerConfig) -> StorageReader:
    if config.storage_driver == "s3":
        if config.s3 is None:
            raise ValueError("S3 configuration missing")
        return S3Storage(config.s3)
    return LocalStorage(config.storage_local_dir)
