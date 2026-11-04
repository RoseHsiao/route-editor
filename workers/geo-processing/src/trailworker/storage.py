"""Read access to object storage. Key rules mirror lib/storage/keys.ts."""

from __future__ import annotations

import re
from pathlib import Path

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
