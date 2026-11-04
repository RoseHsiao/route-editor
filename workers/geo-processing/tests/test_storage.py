from __future__ import annotations

import io
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from botocore.stub import Stubber

from trailworker.config import S3Config
from trailworker.storage import InvalidStorageKeyError, LocalStorage, S3Storage, assert_valid_storage_key

# Keep in sync with tests/unit/storage/storage.test.ts.
INVALID_KEYS = [
    "",
    "/absolute/key",
    "uploads/../secrets",
    "uploads/./x",
    "uploads//x",
    "uploads/x/",
    "uploads/my file.gpx",
    "uploads/.hidden",
    "uploads\\x",
    "a" * 513,
]


@pytest.mark.parametrize("key", INVALID_KEYS)
def test_rejects_unsafe_keys(key: str) -> None:
    with pytest.raises(InvalidStorageKeyError):
        assert_valid_storage_key(key)


def test_accepts_generated_keys() -> None:
    assert_valid_storage_key("uploads/user_1/file-abc.gpx")


def test_reads_files_written_by_the_web_app(tmp_path: Path) -> None:
    (tmp_path / "uploads" / "u1").mkdir(parents=True)
    (tmp_path / "uploads" / "u1" / "f1.gpx").write_bytes(b"<gpx/>")
    storage = LocalStorage(tmp_path)
    assert storage.read("uploads/u1/f1.gpx") == b"<gpx/>"
    assert storage.read("uploads/u1/missing.gpx") is None


def test_cannot_escape_root(tmp_path: Path) -> None:
    (tmp_path / "secret.txt").write_text("x")
    storage = LocalStorage(tmp_path / "root")
    with pytest.raises(InvalidStorageKeyError):
        storage.read("../secret.txt")


def _s3(bucket: str = "uploads") -> tuple[S3Storage, Stubber]:
    client = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url="http://localhost:9",
        aws_access_key_id="test-access-key-not-a-real-credential",
        aws_secret_access_key="test-secret-not-a-real-credential",
    )
    storage = S3Storage(
        S3Config(bucket, None, None, None, None, force_path_style=True),
        client=client,
    )
    return storage, Stubber(client)


def test_s3_reads_objects() -> None:
    storage, stubber = _s3()
    body = StreamingBody(io.BytesIO(b"<gpx/>"), 6)
    stubber.add_response("get_object", {"Body": body}, {"Bucket": "uploads", "Key": "uploads/u1/f1.gpx"})
    with stubber:
        assert storage.read("uploads/u1/f1.gpx") == b"<gpx/>"


def test_s3_missing_objects_read_as_none() -> None:
    storage, stubber = _s3()
    stubber.add_client_error("get_object", service_error_code="NoSuchKey", http_status_code=404)
    with stubber:
        assert storage.read("uploads/u1/missing.gpx") is None


def test_s3_other_errors_propagate() -> None:
    storage, stubber = _s3()
    stubber.add_client_error("get_object", service_error_code="AccessDenied", http_status_code=403)
    with stubber, pytest.raises(ClientError):
        storage.read("uploads/u1/f1.gpx")


def test_s3_validates_keys_before_any_request() -> None:
    storage, _ = _s3()
    with pytest.raises(InvalidStorageKeyError):
        storage.read("../secrets")
