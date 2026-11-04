from __future__ import annotations

from pathlib import Path

import pytest

from trailworker.storage import InvalidStorageKeyError, LocalStorage, assert_valid_storage_key

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
